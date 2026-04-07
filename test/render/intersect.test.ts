/**
 * CPU reference implementations of ray-triangle and ray-segment intersection,
 * matching the WGSL shader logic. Tests validate the math we rely on in the shader.
 */
import { describe, it, expect } from 'vitest'

type Vec3 = [number, number, number]

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}
function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}

/** Moller-Trumbore ray-triangle intersection. Returns t or -1. */
export function rayTriangle(
  origin: Vec3, dir: Vec3,
  v0: Vec3, v1: Vec3, v2: Vec3,
): number {
  const e1 = sub(v1, v0)
  const e2 = sub(v2, v0)
  const h = cross(dir, e2)
  const a = dot(e1, h)
  if (Math.abs(a) < 1e-7) return -1
  const f = 1 / a
  const s = sub(origin, v0)
  const u = f * dot(s, h)
  if (u < 0 || u > 1) return -1
  const q = cross(s, e1)
  const v = f * dot(dir, q)
  if (v < 0 || u + v > 1) return -1
  const t = f * dot(e2, q)
  if (t < 1e-4) return -1
  return t
}

/** Analytical ray-segment closest approach. Returns t or -1. */
export function raySegment(
  origin: Vec3, dir: Vec3,
  p0: Vec3, p1: Vec3, radius: number,
): number {
  const d = sub(p1, p0)
  const w = sub(origin, p0)

  const a_val = dot(dir, dir)
  const b_val = dot(dir, d)
  const c_val = dot(d, d)
  const d_val = dot(dir, w)
  const e_val = dot(d, w)

  const denom = a_val * c_val - b_val * b_val

  let t_seg: number
  if (denom < 1e-7) {
    t_seg = d_val / b_val
  } else {
    t_seg = (a_val * e_val - b_val * d_val) / denom
  }

  t_seg = Math.max(0, Math.min(1, t_seg))
  const segPt = addScaled(p0, d, t_seg)
  const s_ray = dot(sub(segPt, origin), dir) / a_val

  if (s_ray < 1e-4) return -1

  const rayPt = addScaled(origin, dir, s_ray)
  const dist = length(sub(rayPt, segPt))

  if (dist > radius) return -1
  return s_ray
}

/** Front-to-back alpha composite. */
export function composite(hits: { t: number; color: [number, number, number, number] }[], bg: Vec3): Vec3 {
  // Sort by t
  hits.sort((a, b) => a.t - b.t)

  let r = 0, g = 0, b = 0, a = 0
  for (const hit of hits) {
    const [sr, sg, sb, sa] = hit.color
    r += (1 - a) * sa * sr
    g += (1 - a) * sa * sg
    b += (1 - a) * sa * sb
    a += (1 - a) * sa
    if (a > 0.99) break
  }

  return [
    r + (1 - a) * bg[0],
    g + (1 - a) * bg[1],
    b + (1 - a) * bg[2],
  ]
}

// ─── Tests ───

describe('rayTriangle', () => {
  const tri: [Vec3, Vec3, Vec3] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
  ]

  it('hits triangle from above', () => {
    const t = rayTriangle([0.2, 0.2, 5], [0, 0, -1], ...tri)
    expect(t).toBeCloseTo(5)
  })

  it('misses triangle (outside)', () => {
    const t = rayTriangle([2, 2, 5], [0, 0, -1], ...tri)
    expect(t).toBe(-1)
  })

  it('misses triangle (parallel)', () => {
    const t = rayTriangle([0, 0, 0], [1, 0, 0], ...tri)
    expect(t).toBe(-1)
  })

  it('misses triangle (behind ray)', () => {
    const t = rayTriangle([0.2, 0.2, -5], [0, 0, -1], ...tri)
    expect(t).toBe(-1)
  })

  it('hits triangle from below (double-sided)', () => {
    const t = rayTriangle([0.2, 0.2, -5], [0, 0, 1], ...tri)
    expect(t).toBeCloseTo(5)
  })

  it('hits at edge of triangle', () => {
    // Point on edge v0-v1 at (0.5, 0, 0)
    const t = rayTriangle([0.5, 0.001, 5], [0, 0, -1], ...tri)
    expect(t).toBeCloseTo(5)
  })
})

describe('raySegment', () => {
  it('hits segment perpendicular', () => {
    // Segment along X axis, ray from above hitting near center
    const t = raySegment([0.5, 0, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], 0.1)
    expect(t).toBeCloseTo(5)
  })

  it('misses segment (too far)', () => {
    const t = raySegment([0.5, 2, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], 0.1)
    expect(t).toBe(-1)
  })

  it('misses segment (past endpoint)', () => {
    const t = raySegment([2, 0, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], 0.1)
    expect(t).toBe(-1)
  })

  it('hits segment near endpoint', () => {
    const t = raySegment([0.01, 0, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], 0.1)
    expect(t).toBeCloseTo(5)
  })

  it('hits segment behind ray returns -1', () => {
    const t = raySegment([0.5, 0, -5], [0, 0, -1], [0, 0, 0], [1, 0, 0], 0.1)
    expect(t).toBe(-1)
  })

  it('hits angled segment', () => {
    // Segment from (0,0,0) to (0,0,10), ray from the side
    const t = raySegment([5, 0, 5], [-1, 0, 0], [0, 0, 0], [0, 0, 10], 0.2)
    expect(t).toBeCloseTo(5)
  })
})

describe('composite', () => {
  it('opaque hit covers background', () => {
    const result = composite(
      [{ t: 1, color: [1, 0, 0, 1] }],
      [0, 0, 0],
    )
    expect(result[0]).toBeCloseTo(1)
    expect(result[1]).toBeCloseTo(0)
    expect(result[2]).toBeCloseTo(0)
  })

  it('transparent hit blends with background', () => {
    const result = composite(
      [{ t: 1, color: [1, 0, 0, 0.5] }],
      [0, 0, 1],
    )
    expect(result[0]).toBeCloseTo(0.5)
    expect(result[1]).toBeCloseTo(0)
    expect(result[2]).toBeCloseTo(0.5)
  })

  it('two transparent hits composite correctly', () => {
    const result = composite(
      [
        { t: 1, color: [1, 0, 0, 0.5] },
        { t: 2, color: [0, 1, 0, 0.5] },
      ],
      [0, 0, 0],
    )
    // Front: 0.5 red. Remaining alpha: 0.5. Back: 0.5 * 0.5 = 0.25 green.
    expect(result[0]).toBeCloseTo(0.5)
    expect(result[1]).toBeCloseTo(0.25)
    expect(result[2]).toBeCloseTo(0)
  })

  it('sorts by depth', () => {
    // Given out of order, should still composite front-to-back
    const result = composite(
      [
        { t: 2, color: [0, 1, 0, 0.5] },
        { t: 1, color: [1, 0, 0, 0.5] },
      ],
      [0, 0, 0],
    )
    expect(result[0]).toBeCloseTo(0.5)
    expect(result[1]).toBeCloseTo(0.25)
  })

  it('no hits returns background', () => {
    const result = composite([], [0.1, 0.2, 0.3])
    expect(result[0]).toBeCloseTo(0.1)
    expect(result[1]).toBeCloseTo(0.2)
    expect(result[2]).toBeCloseTo(0.3)
  })
})
