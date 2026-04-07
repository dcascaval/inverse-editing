/**
 * BVH construction for the raycast renderer.
 * Top-down build with median split on longest axis.
 * Outputs a flat array of BVHNode for GPU upload.
 */
import type { AABB, BVHNode, GPUTriangle, GPUSegment } from './types'

const MAX_LEAF_SIZE = 4

type PrimRef = {
  aabb: AABB
  centroid: [number, number, number]
  index: number
  type: number // 0 = triangle, 1 = segment
}

function triAABB(t: GPUTriangle): AABB {
  return {
    minX: Math.min(t.v0[0], t.v1[0], t.v2[0]),
    minY: Math.min(t.v0[1], t.v1[1], t.v2[1]),
    minZ: Math.min(t.v0[2], t.v1[2], t.v2[2]),
    maxX: Math.max(t.v0[0], t.v1[0], t.v2[0]),
    maxY: Math.max(t.v0[1], t.v1[1], t.v2[1]),
    maxZ: Math.max(t.v0[2], t.v1[2], t.v2[2]),
  }
}

function segAABB(s: GPUSegment): AABB {
  const r = s.radius
  return {
    minX: Math.min(s.p0[0], s.p1[0]) - r,
    minY: Math.min(s.p0[1], s.p1[1]) - r,
    minZ: Math.min(s.p0[2], s.p1[2]) - r,
    maxX: Math.max(s.p0[0], s.p1[0]) + r,
    maxY: Math.max(s.p0[1], s.p1[1]) + r,
    maxZ: Math.max(s.p0[2], s.p1[2]) + r,
  }
}

function unionAABB(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

function emptyAABB(): AABB {
  return {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
  }
}

function centroidOfAABB(a: AABB): [number, number, number] {
  return [
    (a.minX + a.maxX) * 0.5,
    (a.minY + a.maxY) * 0.5,
    (a.minZ + a.maxZ) * 0.5,
  ]
}

export function buildBVH(
  triangles: GPUTriangle[],
  segments: GPUSegment[],
): { nodes: BVHNode[]; triIndices: number[]; segIndices: number[] } {
  // Build prim refs
  const refs: PrimRef[] = []
  for (let i = 0; i < triangles.length; i++) {
    const aabb = triAABB(triangles[i])
    refs.push({ aabb, centroid: centroidOfAABB(aabb), index: i, type: 0 })
  }
  for (let i = 0; i < segments.length; i++) {
    const aabb = segAABB(segments[i])
    refs.push({ aabb, centroid: centroidOfAABB(aabb), index: i, type: 1 })
  }

  if (refs.length === 0) {
    // Empty scene: single leaf with no primitives
    return {
      nodes: [{
        aabb: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
        leftOrStart: 0, rightOrCount: 0, isLeaf: true, primType: 0,
      }],
      triIndices: [],
      segIndices: [],
    }
  }

  const nodes: BVHNode[] = []
  const triIndices: number[] = []
  const segIndices: number[] = []

  function buildNode(primRefs: PrimRef[]): number {
    // Compute bounds
    let bounds = emptyAABB()
    for (const r of primRefs) bounds = unionAABB(bounds, r.aabb)

    // Leaf condition
    if (primRefs.length <= MAX_LEAF_SIZE) {
      return makeLeaf(primRefs, bounds)
    }

    // Find longest axis of centroid bounds
    let centBounds = emptyAABB()
    for (const r of primRefs) {
      centBounds = unionAABB(centBounds, {
        minX: r.centroid[0], minY: r.centroid[1], minZ: r.centroid[2],
        maxX: r.centroid[0], maxY: r.centroid[1], maxZ: r.centroid[2],
      })
    }
    const dx = centBounds.maxX - centBounds.minX
    const dy = centBounds.maxY - centBounds.minY
    const dz = centBounds.maxZ - centBounds.minZ
    const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2

    // Sort by centroid on chosen axis and split at median
    primRefs.sort((a, b) => a.centroid[axis] - b.centroid[axis])
    const mid = primRefs.length >> 1

    // If all centroids are the same, make a leaf
    if (primRefs[0].centroid[axis] === primRefs[primRefs.length - 1].centroid[axis]) {
      return makeLeaf(primRefs, bounds)
    }

    const nodeIdx = nodes.length
    // Placeholder — we'll fill in children after recursion
    nodes.push({
      aabb: bounds,
      leftOrStart: 0,
      rightOrCount: 0,
      isLeaf: false,
      primType: 0,
    })

    const left = buildNode(primRefs.slice(0, mid))
    const right = buildNode(primRefs.slice(mid))

    nodes[nodeIdx].leftOrStart = left
    nodes[nodeIdx].rightOrCount = right

    return nodeIdx
  }

  function makeLeaf(primRefs: PrimRef[], bounds: AABB): number {
    // Separate into tris and segs, emit two leaves if both present,
    // or a single leaf if only one type.
    const tris = primRefs.filter(r => r.type === 0)
    const segs = primRefs.filter(r => r.type === 1)

    if (tris.length > 0 && segs.length > 0) {
      // Need an internal node with two leaf children
      const nodeIdx = nodes.length
      nodes.push({ aabb: bounds, leftOrStart: 0, rightOrCount: 0, isLeaf: false, primType: 0 })

      const triLeaf = emitLeaf(tris, bounds, 0)
      const segLeaf = emitLeaf(segs, bounds, 1)

      nodes[nodeIdx].leftOrStart = triLeaf
      nodes[nodeIdx].rightOrCount = segLeaf
      return nodeIdx
    }

    if (tris.length > 0) return emitLeaf(tris, bounds, 0)
    return emitLeaf(segs, bounds, 1)
  }

  function emitLeaf(primRefs: PrimRef[], bounds: AABB, primType: number): number {
    const indices = primType === 0 ? triIndices : segIndices
    const start = indices.length
    for (const r of primRefs) indices.push(r.index)

    const nodeIdx = nodes.length
    nodes.push({
      aabb: bounds,
      leftOrStart: start,
      rightOrCount: primRefs.length,
      isLeaf: true,
      primType,
    })
    return nodeIdx
  }

  buildNode(refs)

  return { nodes, triIndices, segIndices }
}
