import { describe, it, expect } from 'vitest'
import { buildBVH } from '@/render/bvh'
import type { GPUTriangle, GPUSegment, BVHNode } from '@/render/types'

function tri(x: number, y: number, z: number): GPUTriangle {
  return {
    v0: [x, y, z],
    v1: [x + 1, y, z],
    v2: [x, y + 1, z],
    color: [1, 0, 0, 1],
  }
}

function seg(x0: number, y0: number, x1: number, y1: number): GPUSegment {
  return {
    p0: [x0, y0, 0],
    p1: [x1, y1, 0],
    color: [0, 1, 0, 1],
    radius: 0.1,
  }
}

describe('buildBVH', () => {
  it('handles empty scene', () => {
    const { nodes, triIndices, segIndices } = buildBVH([], [])
    expect(nodes.length).toBe(1)
    expect(nodes[0].isLeaf).toBe(true)
    expect(triIndices.length).toBe(0)
    expect(segIndices.length).toBe(0)
  })

  it('single triangle becomes a leaf', () => {
    const { nodes, triIndices } = buildBVH([tri(0, 0, 0)], [])
    expect(nodes.length).toBe(1)
    expect(nodes[0].isLeaf).toBe(true)
    expect(nodes[0].primType).toBe(0)
    expect(triIndices).toEqual([0])
  })

  it('single segment becomes a leaf', () => {
    const { nodes, segIndices } = buildBVH([], [seg(0, 0, 1, 1)])
    expect(nodes.length).toBe(1)
    expect(nodes[0].isLeaf).toBe(true)
    expect(nodes[0].primType).toBe(1)
    expect(segIndices).toEqual([0])
  })

  it('all primitives are reachable', () => {
    const tris = Array.from({ length: 20 }, (_, i) => tri(i * 3, 0, 0))
    const segs = Array.from({ length: 10 }, (_, i) => seg(i * 3, 5, i * 3 + 1, 5))

    const { nodes, triIndices, segIndices } = buildBVH(tris, segs)

    // Collect all leaf-referenced indices
    const reachedTri = new Set<number>()
    const reachedSeg = new Set<number>()

    function visit(ni: number) {
      const n = nodes[ni]
      if (n.isLeaf) {
        const indices = n.primType === 0 ? triIndices : segIndices
        const target = n.primType === 0 ? reachedTri : reachedSeg
        for (let i = n.leftOrStart; i < n.leftOrStart + n.rightOrCount; i++) {
          target.add(indices[i])
        }
      } else {
        visit(n.leftOrStart)
        visit(n.rightOrCount)
      }
    }
    visit(0)

    expect(reachedTri.size).toBe(20)
    expect(reachedSeg.size).toBe(10)
    for (let i = 0; i < 20; i++) expect(reachedTri.has(i)).toBe(true)
    for (let i = 0; i < 10; i++) expect(reachedSeg.has(i)).toBe(true)
  })

  it('AABBs contain their children', () => {
    const tris = Array.from({ length: 10 }, (_, i) => tri(i * 5, i * 3, 0))
    const { nodes } = buildBVH(tris, [])

    function check(ni: number) {
      const n = nodes[ni]
      if (!n.isLeaf) {
        const left = nodes[n.leftOrStart]
        const right = nodes[n.rightOrCount]
        // Parent AABB must contain both children
        expect(n.aabb.minX).toBeLessThanOrEqual(left.aabb.minX)
        expect(n.aabb.minY).toBeLessThanOrEqual(left.aabb.minY)
        expect(n.aabb.maxX).toBeGreaterThanOrEqual(left.aabb.maxX)
        expect(n.aabb.maxY).toBeGreaterThanOrEqual(left.aabb.maxY)
        expect(n.aabb.minX).toBeLessThanOrEqual(right.aabb.minX)
        expect(n.aabb.minY).toBeLessThanOrEqual(right.aabb.minY)
        expect(n.aabb.maxX).toBeGreaterThanOrEqual(right.aabb.maxX)
        expect(n.aabb.maxY).toBeGreaterThanOrEqual(right.aabb.maxY)
        check(n.leftOrStart)
        check(n.rightOrCount)
      }
    }
    check(0)
  })

  it('mixed tris and segments at leaf level', () => {
    // Put a tri and a seg at the same location — should end up as two leaves under one internal node
    const tris = [tri(0, 0, 0)]
    const segs = [seg(0, 0, 1, 0)]
    const { nodes, triIndices, segIndices } = buildBVH(tris, segs)

    // Root should be internal with two leaf children
    const root = nodes[0]
    expect(root.isLeaf).toBe(false)

    const left = nodes[root.leftOrStart]
    const right = nodes[root.rightOrCount]
    expect(left.isLeaf).toBe(true)
    expect(right.isLeaf).toBe(true)

    // One should be tri, other seg
    const types = [left.primType, right.primType].sort()
    expect(types).toEqual([0, 1])

    expect(triIndices.length).toBe(1)
    expect(segIndices.length).toBe(1)
  })
})
