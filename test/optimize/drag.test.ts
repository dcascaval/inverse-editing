import { describe, it, expect, beforeAll } from 'vitest'
import { parse } from '@/lang/parser'
import { executeProgram } from '@/lang/interpreter'
import type { AnnotatedEdge2 } from '@/lang/interpreter'
import { DualValue, dual, extractSubTape } from '@/lang/grad'
import { findClosestEdge, buildDragSession, optimizeDrag } from '@/optimize/drag'
import { useStore } from '@/store'
import nlopt from '@/vendor/nlopt'

beforeAll(async () => {
  await nlopt.ready
})

function runDual(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  return executeProgram(program, paramValues, 'dual')
}

/** Set up store sliders to match parameters */
function syncStore(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  const sliders = program.parameters.parameters.map((p) => ({
    name: p.name,
    min: p.bounds.min !== p.bounds.mid ? p.bounds.min : 1,
    max: p.bounds.max !== p.bounds.mid ? p.bounds.max : 100,
    step: 0.01,
    value: paramValues?.get(p.name) ?? p.bounds.mid,
  }))
  useStore.getState().setSliders(sliders)
}

describe('findClosestEdge', () => {
  it('finds the closest edge and computes t', () => {
    const result = runDual('parameters { w: 10 }\ndraw(rect(0, 0, w, 5))')
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)

    // Click near the middle of the bottom edge (0,0)→(10,0)
    const hit = findClosestEdge(edges, 5, 0.1)
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(0.5, 1)
    expect(hit!.dist).toBeCloseTo(0.1, 1)
  })

  it('returns null for empty edges', () => {
    expect(findClosestEdge([], 0, 0)).toBeNull()
  })

  it('clamps t to [0, 1]', () => {
    const result = runDual('parameters {}\ndraw(rect(0, 0, 10, 5))')
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)

    // Click way past the end of the bottom edge
    const hit = findClosestEdge(edges, 20, 0)
    expect(hit).not.toBeNull()
    expect(hit!.t).toBe(1)
  })
})

describe('buildDragSession', () => {
  it('creates a sub-tape with pseudo-parameters', () => {
    const src = 'parameters { x: 5 }\ndraw(rect(0, 0, x, x))'
    syncStore(src)
    const result = runDual(src)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)

    const hit = findClosestEdge(edges, 2.5, 0)!
    const session = buildDragSession(result.tape!, hit.edge, hit.t, 2.5, 0, 0.1)

    expect(session.subTape).toBeDefined()
    expect(session.paramNames).toContain('x')
    expect(session.subTape.paramIndices.has('__targetX')).toBe(true)
    expect(session.subTape.paramIndices.has('__targetY')).toBe(true)
    expect(session.subTape.paramIndices.has('__ptX')).toBe(true)
    expect(session.subTape.paramIndices.has('__ptY')).toBe(true)

    // The original tape should have been cleaned up
    expect(result.tape!.paramIndices.has('__targetX')).toBe(false)
  })
})

describe('optimizeDrag', () => {
  it('optimizes a point on a horizontal line toward a target', async () => {
    // Simple case: rect(0, 0, w, 5). Bottom edge goes from (0,0) to (w, 0).
    // Click at the right end (t=1 on bottom edge) and drag to (15, 0).
    // Should increase w from 10 toward 15.
    const src = 'parameters { w: 0 < 10 < 50 }\ndraw(rect(0, 0, w, 5))'
    syncStore(src)
    const result = runDual(src)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)

    // Find the bottom edge's right endpoint
    const hit = findClosestEdge(edges, 10, 0)!
    expect(hit.t).toBeCloseTo(1, 1)

    const session = buildDragSession(result.tape!, hit.edge, hit.t, 10, 0, 0.01)
    const pt = await optimizeDrag(session, 15, 0)

    // w should have moved toward 15
    const newW = useStore.getState().sliders.find((s) => s.name === 'w')!.value
    expect(newW).toBeGreaterThan(12)
    expect(newW).toBeLessThan(18)
  })
})
