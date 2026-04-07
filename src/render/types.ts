/** GPU-side primitive types for the raycast renderer. */

/** 3 vertices (9 floats) + RGBA color (4 floats) = 13 floats per triangle. */
export type GPUTriangle = {
  v0: [number, number, number]
  v1: [number, number, number]
  v2: [number, number, number]
  color: [number, number, number, number]
}

/** 2 endpoints (6 floats) + RGBA color (4 floats) + radius (1 float) = 11 floats per segment. */
export type GPUSegment = {
  p0: [number, number, number]
  p1: [number, number, number]
  color: [number, number, number, number]
  radius: number
}

export type AABB = {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}

/**
 * Flattened BVH node for GPU upload.
 * Internal node: left/right are child indices.
 * Leaf node: start/count index into tri_indices or seg_indices.
 */
export type BVHNode = {
  aabb: AABB
  // For internal: leftChild index, rightChild index
  // For leaf: primStart, primCount
  leftOrStart: number
  rightOrCount: number
  isLeaf: boolean
  // 0 = triangle, 1 = segment (only meaningful for leaves)
  primType: number
}

/** Complete scene data ready for GPU upload. */
export type GPUScene = {
  triangles: GPUTriangle[]
  segments: GPUSegment[]
  bvhNodes: BVHNode[]
  triIndices: number[]
  segIndices: number[]
}
