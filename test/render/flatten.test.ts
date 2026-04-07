import { describe, it, expect } from 'vitest'
import { flattenBatches } from '@/render/flatten'
import type { DrawBatch } from '@/lang/interpreter'

function emptyBatch(overrides: Partial<DrawBatch> = {}): DrawBatch {
  return {
    points: [],
    edges: [],
    polygons: [],
    quads3: [],
    planarFaces3: [],
    style: {},
    ...overrides,
  }
}

describe('flattenBatches', () => {
  it('empty batches produce no primitives', () => {
    const { triangles, segments } = flattenBatches([])
    expect(triangles.length).toBe(0)
    expect(segments.length).toBe(0)
  })

  it('quad produces 2 triangles', () => {
    const batch = emptyBatch({
      quads3: [[
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ]],
      style: { fill: '#ff0000', opacity: 1 },
    })
    const { triangles } = flattenBatches([batch])
    expect(triangles.length).toBe(2)
    // Color should be red with 0.35 opacity (3D face)
    expect(triangles[0].color[0]).toBeCloseTo(1)
    expect(triangles[0].color[1]).toBeCloseTo(0)
    expect(triangles[0].color[2]).toBeCloseTo(0)
    expect(triangles[0].color[3]).toBeCloseTo(0.35)
  })

  it('polygon produces triangles', () => {
    const batch = emptyBatch({
      polygons: [{
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      }],
      style: { fill: '#00ff00', opacity: 0.8 },
    })
    const { triangles } = flattenBatches([batch])
    // A quad polygon should produce 2 triangles
    expect(triangles.length).toBe(2)
    expect(triangles[0].color[1]).toBeCloseTo(1) // green
    expect(triangles[0].color[3]).toBeCloseTo(0.8)
  })

  it('edges produce segments', () => {
    const batch = emptyBatch({
      edges: [
        { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
        { start: { x: 1, y: 1 }, end: { x: 2, y: 0 } },
      ],
      style: { stroke: '#0000ff' },
    })
    const { segments } = flattenBatches([batch])
    expect(segments.length).toBe(2)
    expect(segments[0].color[2]).toBeCloseTo(1) // blue
    expect(segments[0].p0).toEqual([0, 0, 0])
    expect(segments[0].p1).toEqual([1, 1, 0])
  })

  it('default colors when style is empty', () => {
    const batch = emptyBatch({
      edges: [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
      polygons: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
    })
    const { triangles, segments } = flattenBatches([batch])
    // Colors parsed via THREE.Color (sRGB → linear)
    expect(triangles[0].color[0]).toBeGreaterThan(0)
    expect(triangles[0].color[0]).toBeLessThan(1)
    expect(segments[0].color[0]).toBeGreaterThan(0)
    // Default opacity = 1
    expect(triangles[0].color[3]).toBeCloseTo(1)
    expect(segments[0].color[3]).toBeCloseTo(1)
  })

  it('multiple batches combine primitives', () => {
    const b1 = emptyBatch({
      edges: [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
    })
    const b2 = emptyBatch({
      polygons: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
    })
    const { triangles, segments } = flattenBatches([b1, b2])
    expect(segments.length).toBe(1)
    expect(triangles.length).toBe(1)
  })
})
