/**
 * WebGPU raycast pipeline.
 * Manages device, buffers, compute + display pipelines.
 * Scene data stays on GPU between frames; only rebuilt when React pushes new batches.
 */
import type { DrawBatch } from '@/lang/interpreter'
import type { BVHNode, GPUTriangle, GPUSegment } from '@/render/types'
import { flattenBatches } from '@/render/flatten'
import { buildBVH } from '@/render/bvh'
import shaderSource from '@/render/shader.wgsl?raw'
import displaySource from '@/render/display.wgsl?raw'

// Camera uniform layout (must match WGSL Camera struct):
// mat4x4 viewProj     (64 bytes, offset 0)
// mat4x4 invViewProj  (64 bytes, offset 64)
// vec3   eye          (12 bytes, offset 128)
// f32    isOrtho      (4 bytes,  offset 140)
// f32    width        (4 bytes,  offset 144)
// f32    height       (4 bytes,  offset 148)
// f32    _pad0        (4 bytes,  offset 152)
// f32    _pad1        (4 bytes,  offset 156)
const CAMERA_BUFFER_SIZE = 160

export type CameraData = {
  viewProjectionMatrix: Float32Array  // 16 floats
  invViewProjectionMatrix: Float32Array // 16 floats
  eye: [number, number, number]
  isOrtho: boolean
}

export class RaycastPipeline {
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat

  private computePipeline!: GPUComputePipeline
  private displayPipeline!: GPURenderPipeline
  private sampler!: GPUSampler

  private cameraBuffer!: GPUBuffer
  private nodesBuffer!: GPUBuffer
  private trianglesBuffer!: GPUBuffer
  private segmentsBuffer!: GPUBuffer
  private triIndicesBuffer!: GPUBuffer
  private segIndicesBuffer!: GPUBuffer

  private outputTexture!: GPUTexture
  private computeBindGroup!: GPUBindGroup
  private displayBindGroup!: GPUBindGroup

  private computeBindGroupLayout!: GPUBindGroupLayout
  private displayBindGroupLayout!: GPUBindGroupLayout

  private canvas!: HTMLCanvasElement
  private width = 0
  private height = 0
  private animFrameId = 0
  private latestCamera: CameraData | null = null
  private destroyed = false
  private ready = false
  private pendingBatches: DrawBatch[] | null = null

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) return false
    this.device = await adapter.requestDevice()
    this.context = canvas.getContext('webgpu')!
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })

    // Compute pipeline
    const computeModule = this.device.createShaderModule({ code: shaderSource })
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      ],
    })
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'main' },
    })

    // Display pipeline
    const displayModule = this.device.createShaderModule({ code: displaySource })
    this.displayBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })
    this.displayPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.displayBindGroupLayout] }),
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: {
        module: displayModule,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    })

    this.sampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })

    // Camera buffer (persistent)
    this.cameraBuffer = this.device.createBuffer({
      size: CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Initialize with empty scene
    this.uploadScene([], [])

    this.ready = true

    // Flush any scene that arrived before init completed
    if (this.pendingBatches) {
      this.updateScene(this.pendingBatches)
      this.pendingBatches = null
    }

    return true
  }

  /** Rebuild acceleration structure and upload everything to GPU. */
  updateScene(batches: DrawBatch[]) {
    if (!this.ready) {
      this.pendingBatches = batches
      return
    }
    const { triangles, segments } = flattenBatches(batches)
    this.uploadScene(triangles, segments)
  }

  private uploadScene(triangles: GPUTriangle[], segments: GPUSegment[]) {
    const { nodes, triIndices, segIndices } = buildBVH(triangles, segments)

    // Pack nodes: each BVHNode = 12 u32s (48 bytes)
    // [minX, minY, minZ, leftOrStart, maxX, maxY, maxZ, rightOrCount, flags, pad, pad, pad]
    const nodesData = new ArrayBuffer(Math.max(nodes.length * 48, 48))
    const nodesF32 = new Float32Array(nodesData)
    const nodesU32 = new Uint32Array(nodesData)
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const o = i * 12
      nodesF32[o + 0] = n.aabb.minX
      nodesF32[o + 1] = n.aabb.minY
      nodesF32[o + 2] = n.aabb.minZ
      nodesU32[o + 3] = n.leftOrStart
      nodesF32[o + 4] = n.aabb.maxX
      nodesF32[o + 5] = n.aabb.maxY
      nodesF32[o + 6] = n.aabb.maxZ
      nodesU32[o + 7] = n.rightOrCount
      nodesU32[o + 8] = (n.isLeaf ? 1 : 0) | (n.primType << 1)
      nodesU32[o + 9] = 0
      nodesU32[o + 10] = 0
      nodesU32[o + 11] = 0
    }

    // Pack triangles: each = 16 floats (64 bytes)
    // [v0.xyz, pad, v1.xyz, pad, v2.xyz, pad, color.rgba]
    const triData = new Float32Array(Math.max(triangles.length * 16, 16))
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i]
      const o = i * 16
      triData[o + 0] = t.v0[0]; triData[o + 1] = t.v0[1]; triData[o + 2] = t.v0[2]; triData[o + 3] = 0
      triData[o + 4] = t.v1[0]; triData[o + 5] = t.v1[1]; triData[o + 6] = t.v1[2]; triData[o + 7] = 0
      triData[o + 8] = t.v2[0]; triData[o + 9] = t.v2[1]; triData[o + 10] = t.v2[2]; triData[o + 11] = 0
      triData[o + 12] = t.color[0]; triData[o + 13] = t.color[1]; triData[o + 14] = t.color[2]; triData[o + 15] = t.color[3]
    }

    // Pack segments: each = 16 floats (64 bytes)
    // [p0.xyz, pad, p1.xyz, pad, color.rgba, radius, pad, pad, pad]
    const segData = new Float32Array(Math.max(segments.length * 16, 16))
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      const o = i * 16
      segData[o + 0] = s.p0[0]; segData[o + 1] = s.p0[1]; segData[o + 2] = s.p0[2]; segData[o + 3] = 0
      segData[o + 4] = s.p1[0]; segData[o + 5] = s.p1[1]; segData[o + 6] = s.p1[2]; segData[o + 7] = 0
      segData[o + 8] = s.color[0]; segData[o + 9] = s.color[1]; segData[o + 10] = s.color[2]; segData[o + 11] = s.color[3]
      segData[o + 12] = s.radius; segData[o + 13] = 0; segData[o + 14] = 0; segData[o + 15] = 0
    }

    // Pack index arrays
    const triIdxData = new Uint32Array(Math.max(triIndices.length, 1))
    triIdxData.set(triIndices)
    const segIdxData = new Uint32Array(Math.max(segIndices.length, 1))
    segIdxData.set(segIndices)

    // Recreate buffers
    this.nodesBuffer?.destroy()
    this.trianglesBuffer?.destroy()
    this.segmentsBuffer?.destroy()
    this.triIndicesBuffer?.destroy()
    this.segIndicesBuffer?.destroy()

    const mkStorage = (data: ArrayBuffer) =>
      this.device.createBuffer({
        size: Math.max(data.byteLength, 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      })

    this.nodesBuffer = mkStorage(nodesData)
    new Uint8Array(this.nodesBuffer.getMappedRange()).set(new Uint8Array(nodesData))
    this.nodesBuffer.unmap()

    this.trianglesBuffer = mkStorage(triData.buffer as ArrayBuffer)
    new Float32Array(this.trianglesBuffer.getMappedRange()).set(triData)
    this.trianglesBuffer.unmap()

    this.segmentsBuffer = mkStorage(segData.buffer as ArrayBuffer)
    new Float32Array(this.segmentsBuffer.getMappedRange()).set(segData)
    this.segmentsBuffer.unmap()

    this.triIndicesBuffer = mkStorage(triIdxData.buffer as ArrayBuffer)
    new Uint32Array(this.triIndicesBuffer.getMappedRange()).set(triIdxData)
    this.triIndicesBuffer.unmap()

    this.segIndicesBuffer = mkStorage(segIdxData.buffer as ArrayBuffer)
    new Uint32Array(this.segIndicesBuffer.getMappedRange()).set(segIdxData)
    this.segIndicesBuffer.unmap()

    // Recreate compute bind group if we have a valid output texture
    if (this.outputTexture) {
      this.rebuildBindGroups()
    }
  }

  private ensureOutputTexture(w: number, h: number) {
    if (this.width === w && this.height === h && this.outputTexture) return
    this.width = w
    this.height = h

    this.outputTexture?.destroy()
    this.outputTexture = this.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })

    this.rebuildBindGroups()
  }

  private rebuildBindGroups() {
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.nodesBuffer } },
        { binding: 2, resource: { buffer: this.trianglesBuffer } },
        { binding: 3, resource: { buffer: this.segmentsBuffer } },
        { binding: 4, resource: { buffer: this.triIndicesBuffer } },
        { binding: 5, resource: { buffer: this.segIndicesBuffer } },
        { binding: 6, resource: this.outputTexture.createView() },
      ],
    })

    this.displayBindGroup = this.device.createBindGroup({
      layout: this.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.sampler },
      ],
    })
  }

  /** Update camera uniforms and render a frame. */
  render(camera: CameraData, canvasWidth: number, canvasHeight: number) {
    if (!this.ready) return
    this.ensureOutputTexture(canvasWidth, canvasHeight)

    // Upload camera
    const camData = new Float32Array(CAMERA_BUFFER_SIZE / 4)
    camData.set(camera.viewProjectionMatrix, 0)
    camData.set(camera.invViewProjectionMatrix, 16)
    camData[32] = camera.eye[0]
    camData[33] = camera.eye[1]
    camData[34] = camera.eye[2]
    camData[35] = camera.isOrtho ? 1.0 : 0.0
    camData[36] = canvasWidth
    camData[37] = canvasHeight
    this.device.queue.writeBuffer(this.cameraBuffer, 0, camData)

    const encoder = this.device.createCommandEncoder()

    // Compute pass
    const computePass = encoder.beginComputePass()
    computePass.setPipeline(this.computePipeline)
    computePass.setBindGroup(0, this.computeBindGroup)
    computePass.dispatchWorkgroups(
      Math.ceil(canvasWidth / 8),
      Math.ceil(canvasHeight / 8),
    )
    computePass.end()

    // Display pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.941, g: 0.941, b: 0.941, a: 1 },
      }],
    })
    renderPass.setPipeline(this.displayPipeline)
    renderPass.setBindGroup(0, this.displayBindGroup)
    renderPass.draw(3)
    renderPass.end()

    this.device.queue.submit([encoder.finish()])
  }

  /** Start continuous render loop. Call setCamera() to update. */
  startLoop(getCamera: () => CameraData, canvas: HTMLCanvasElement) {
    const loop = () => {
      if (this.destroyed) return
      const cam = this.latestCamera ?? getCamera()
      const w = canvas.width
      const h = canvas.height
      if (w > 0 && h > 0) {
        this.render(cam, w, h)
      }
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }

  setCamera(cam: CameraData) {
    this.latestCamera = cam
  }

  stopLoop() {
    cancelAnimationFrame(this.animFrameId)
  }

  destroy() {
    this.destroyed = true
    this.stopLoop()
    this.outputTexture?.destroy()
    this.nodesBuffer?.destroy()
    this.trianglesBuffer?.destroy()
    this.segmentsBuffer?.destroy()
    this.triIndicesBuffer?.destroy()
    this.segIndicesBuffer?.destroy()
    this.cameraBuffer?.destroy()
    this.device?.destroy()
  }
}
