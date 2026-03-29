import { expect } from 'vitest'
import { parse } from '@/lang/parser'
import { executeProgram } from '@/lang/interpreter'
import type { Point2, Edge2 } from '@/lang/values'

export function run(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  return executeProgram(program, paramValues)
}

export function runOk(src: string) {
  const result = run(src)
  expect(result.error).toBeNull()
  return result
}

/** Flatten all batches into a single points/edges list for simple assertions */
export function drawn(src: string) {
  const { drawBuffer } = run(src)
  const points: Point2[] = []
  const edges: Edge2[] = []
  for (const b of drawBuffer.batches) {
    points.push(...b.points)
    edges.push(...b.edges)
  }
  return { points, edges, batches: drawBuffer.batches }
}

export function drawnPointCount(src: string): number {
  const { drawBuffer } = run(src)
  return drawBuffer.batches.flatMap((b) => b.points).length
}

export function drawnEdgeCount(src: string): number {
  const { drawBuffer } = run(src)
  return drawBuffer.batches.flatMap((b) => b.edges).length
}
