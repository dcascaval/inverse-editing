/**
 * WebGPU raycast Viewport.
 * Uses Three.js headlessly for camera math only (projection/view matrices).
 * Renders via compute shader raycast pipeline.
 */
import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useStore } from '@/store'
import { RaycastPipeline, type CameraData } from '@/render/pipeline'

function getCameraData(camera: THREE.Camera, isOrtho: boolean): CameraData {
  camera.updateMatrixWorld()
  const vp = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  )
  const ivp = vp.clone().invert()
  const eye = new THREE.Vector3()
  camera.getWorldPosition(eye)

  return {
    viewProjectionMatrix: new Float32Array(vp.elements),
    invViewProjectionMatrix: new Float32Array(ivp.elements),
    eye: [eye.x, eye.y, eye.z],
    isOrtho,
  }
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pipelineRef = useRef<RaycastPipeline | null>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const cameraMode = useStore((s) => s.cameraMode)
  const scene = useStore((s) => s.scene)
  const setCameraMode = useStore((s) => s.setCameraMode)

  // Orbit state for 3D mode
  const orbitRef = useRef({
    theta: Math.PI / 4,   // azimuth
    phi: Math.PI / 4,     // elevation
    radius: 120,
    target: new THREE.Vector3(0, 0, 0),
    dragging: false,
    lastX: 0,
    lastY: 0,
    // Pan state
    panning: false,
  })

  // 2D pan/zoom state
  const panRef = useRef({
    offsetX: 0,
    offsetY: 0,
    zoom: 8,
    dragging: false,
    lastX: 0,
    lastY: 0,
  })

  const isOrtho = cameraMode === '2d'

  const buildCamera = useCallback((): THREE.Camera => {
    const canvas = canvasRef.current!
    const aspect = canvas.width / canvas.height

    if (isOrtho) {
      const pan = panRef.current
      const halfW = (canvas.width / pan.zoom) / 2
      const halfH = (canvas.height / pan.zoom) / 2
      const cam = new THREE.OrthographicCamera(
        -halfW + pan.offsetX, halfW + pan.offsetX,
        halfH + pan.offsetY, -halfH + pan.offsetY,
        0.1, 1000,
      )
      cam.position.set(0, 0, 100)
      cam.lookAt(0, 0, 0)
      cam.updateProjectionMatrix()
      return cam
    } else {
      const orb = orbitRef.current
      const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000)
      const x = orb.target.x + orb.radius * Math.sin(orb.phi) * Math.cos(orb.theta)
      const y = orb.target.y + orb.radius * Math.sin(orb.phi) * Math.sin(orb.theta)
      const z = orb.target.z + orb.radius * Math.cos(orb.phi)
      cam.position.set(x, y, z)
      cam.up.set(0, 0, 1)
      cam.lookAt(orb.target)
      cam.updateProjectionMatrix()
      return cam
    }
  }, [isOrtho])

  const pushCamera = useCallback(() => {
    const pipeline = pipelineRef.current
    if (!pipeline) return
    const cam = buildCamera()
    cameraRef.current = cam
    pipeline.setCamera(getCameraData(cam, isOrtho))
  }, [buildCamera, isOrtho])

  // Init pipeline
  useEffect(() => {
    const canvas = canvasRef.current!
    const container = canvas.parentElement!

    // Set initial canvas size before WebGPU init
    const dpr = window.devicePixelRatio
    canvas.width = Math.floor(container.clientWidth * dpr)
    canvas.height = Math.floor(container.clientHeight * dpr)

    const pipeline = new RaycastPipeline()
    pipelineRef.current = pipeline

    let mounted = true

    pipeline.init(canvas).then((ok) => {
      if (!mounted || !ok) return

      // Push initial scene if we have one
      const currentScene = useStore.getState().scene
      if (currentScene.length > 0) {
        pipeline.updateScene(currentScene)
      }

      // Initial camera
      const cam = buildCamera()
      cameraRef.current = cam
      const camData = getCameraData(cam, isOrtho)

      pipeline.startLoop(() => camData, canvas)
    })

    return () => {
      mounted = false
      pipeline.destroy()
      pipelineRef.current = null
    }
    // Intentionally only run on mount/unmount + camera mode change
  }, [cameraMode])

  // Push scene to GPU when batches change
  useEffect(() => {
    pipelineRef.current?.updateScene(scene)
  }, [scene])

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current!
    const container = canvas.parentElement!

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      const dpr = window.devicePixelRatio
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      pushCamera()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [pushCamera])

  // Mouse handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isOrtho) {
      panRef.current.dragging = true
      panRef.current.lastX = e.clientX
      panRef.current.lastY = e.clientY
    } else {
      const orb = orbitRef.current
      if (e.button === 2 || e.shiftKey) {
        orb.panning = true
      } else {
        orb.dragging = true
      }
      orb.lastX = e.clientX
      orb.lastY = e.clientY
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [isOrtho])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (isOrtho) {
      const pan = panRef.current
      if (!pan.dragging) return
      const dx = e.clientX - pan.lastX
      const dy = e.clientY - pan.lastY
      pan.lastX = e.clientX
      pan.lastY = e.clientY
      const dpr = window.devicePixelRatio
      pan.offsetX -= dx * dpr / pan.zoom
      pan.offsetY += dy * dpr / pan.zoom
      pushCamera()
    } else {
      const orb = orbitRef.current
      if (!orb.dragging && !orb.panning) return
      const dx = e.clientX - orb.lastX
      const dy = e.clientY - orb.lastY
      orb.lastX = e.clientX
      orb.lastY = e.clientY

      if (orb.panning) {
        // Pan in camera-local XY
        const cam = cameraRef.current
        if (cam) {
          const right = new THREE.Vector3()
          const up = new THREE.Vector3()
          cam.getWorldDirection(new THREE.Vector3())
          right.setFromMatrixColumn(cam.matrixWorld, 0)
          up.setFromMatrixColumn(cam.matrixWorld, 1)
          const scale = orb.radius * 0.002
          orb.target.addScaledVector(right, -dx * scale)
          orb.target.addScaledVector(up, dy * scale)
        }
      } else {
        orb.theta -= dx * 0.005
        orb.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orb.phi - dy * 0.005))
      }
      pushCamera()
    }
  }, [isOrtho, pushCamera])

  const onPointerUp = useCallback(() => {
    if (isOrtho) {
      panRef.current.dragging = false
    } else {
      orbitRef.current.dragging = false
      orbitRef.current.panning = false
    }
  }, [isOrtho])

  // Attach wheel as non-passive so we can preventDefault
  useEffect(() => {
    const canvas = canvasRef.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (isOrtho) {
        const pan = panRef.current
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        pan.zoom *= factor
        pushCamera()
      } else {
        const orb = orbitRef.current
        orb.radius *= e.deltaY > 0 ? 1.1 : 0.9
        orb.radius = Math.max(1, Math.min(5000, orb.radius))
        pushCamera()
      }
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [isOrtho, pushCamera])

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => setCameraMode(cameraMode === '2d' ? '3d' : '2d')}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          padding: '4px 10px', background: '#27272a', color: '#e4e4e7',
          border: '1px solid #3f3f46', borderRadius: 4, cursor: 'pointer',
          fontSize: 13, fontFamily: 'monospace',
        }}
      >
        {cameraMode === '2d' ? '2D' : '3D'}
      </button>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', background: '#f0f0f0' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  )
}
