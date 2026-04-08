/**
 * Drag-to-optimize: click a drawn edge, drag to move the closest point
 * by optimizing program parameters via NLOpt SLSQP.
 */

import type { AnnotatedEdge2 } from '@/lang/interpreter'
import { DualValue, dual, extractSubTape, type Tape } from '@/lang/grad'
import nlopt from '@/vendor/nlopt'
import { useStore } from '@/store'
import { rerunProgram } from '@/execute'

export type DragSession = {
  /** Compact sub-tape for the optimization objective */
  subTape: Tape
  /** Program parameter names (optimized by NLOpt) */
  paramNames: string[]
  /** Initial parameter values (L1 regularization baseline) */
  initialParams: Map<string, number>
  /** Current optimized point position (for yellow dot) */
  optimizedPoint: { x: number; y: number } | null
}

/** Find the closest edge to a world-space point. Returns the edge and t in [0,1]. */
export function findClosestEdge(
  edges: AnnotatedEdge2[],
  wx: number, wy: number,
): { edge: AnnotatedEdge2; t: number; dist: number } | null {
  let best: { edge: AnnotatedEdge2; t: number; dist: number } | null = null

  for (const edge of edges) {
    if (!edge.sourceStart || !edge.sourceEnd) continue

    const sx = edge.start.x, sy = edge.start.y
    const ex = edge.end.x, ey = edge.end.y
    const dx = ex - sx, dy = ey - sy
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-12) continue

    const t = Math.max(0, Math.min(1, ((wx - sx) * dx + (wy - sy) * dy) / len2))
    const px = sx + t * dx, py = sy + t * dy
    const dist = Math.hypot(wx - px, wy - py)

    if (!best || dist < best.dist) {
      best = { edge, t, dist }
    }
  }

  return best
}


/* L1 Reg. Weight */
const LAMBDA = 0.1

/**
 * Build the optimization objective on the tape and extract a sub-tape.
 *
 * Loss = |evaluateAt(segment, t) - target|^2 + lambda * sum(|p_i - p0_i|)
 *
 * evaluateAt = start + (end - start) * t
 *
 * The target x/y are registered as pseudo-parameters (__targetX, __targetY) so
 * they can be updated via the params map on each drag move without rebuilding.
 * The evaluated point (__ptX, __ptY) is also registered so its position can be
 * read back after forward passes.
 */
export function buildDragSession(
  tape: Tape,
  edge: AnnotatedEdge2,
  t: number,
  targetX: number,
  targetY: number,
): DragSession {
  const start = edge.sourceStart!
  const end = edge.sourceEnd!

  // evaluateAt(segment, t) = start + (end - start) * t
  const tVal = dual(tape, t)
  const startX = start.x as DualValue
  const startY = start.y as DualValue
  const endX = end.x as DualValue
  const endY = end.y as DualValue
  const ptX = startX.add(endX.sub(startX).mul(tVal))
  const ptY = startY.add(endY.sub(startY).mul(tVal))

  // Target as pseudo-parameters (updatable via forward/forwardBackward params map)
  const txIdx = tape.pushParam('__targetX', targetX)
  const tyIdx = tape.pushParam('__targetY', targetY)
  const txVal = new DualValue(tape, txIdx)
  const tyVal = new DualValue(tape, tyIdx)

  // Distance loss: |pt - target|^2
  const dxVal = ptX.sub(txVal)
  const dyVal = ptY.sub(tyVal)
  let loss = dxVal.mul(dxVal).add(dyVal.mul(dyVal))

  // L1 regularization: lambda * sum(|p_i - p0_i|)
  const paramNames: string[] = [...tape.paramIndices.keys()].filter(
    (n) => !n.startsWith('__'),
  )
  const initialParams = new Map<string, number>()
  for (const s of useStore.getState().sliders) {
    initialParams.set(s.name, s.value)
  }

  if (LAMBDA > 0) {
    for (const name of paramNames) {
      const paramIdx = tape.paramIndices.get(name)!
      const paramVal = new DualValue(tape, paramIdx)
      const p0 = dual(tape, initialParams.get(name) ?? 0)
      const diff = paramVal.sub(p0).abs()
      loss = loss.add(diff.mul(dual(tape, LAMBDA)))
    }
  }

  // Register computed nodes as pseudo-params so their sub-tape indices are tracked.
  // forward() won't overwrite them because we never pass these in the params map —
  // they get recomputed normally as non-Const nodes.
  tape.paramIndices.set('__ptX', ptX.index)
  tape.paramIndices.set('__ptY', ptY.index)
  tape.paramIndices.set('__loss', loss.index)

  const subTape = extractSubTape(tape, loss.index)

  // Clean up pseudo-params from the original tape (it may be reused/stored)
  tape.paramIndices.delete('__ptX')
  tape.paramIndices.delete('__ptY')
  tape.paramIndices.delete('__loss')
  tape.paramIndices.delete('__targetX')
  tape.paramIndices.delete('__targetY')

  return {
    subTape,
    paramNames,
    initialParams,
    optimizedPoint: null,
  }
}

/**
 * Run the NLOpt SLSQP optimizer for one drag event.
 * Updates slider values and re-executes the program for display.
 * Returns the evaluated point position on the optimized geometry.
 */
export async function optimizeDrag(
  session: DragSession,
  targetX: number,
  targetY: number,
): Promise<{ x: number; y: number }> {
  await nlopt.ready
  const { subTape, paramNames } = session
  const lossIdx = subTape.paramIndices.get('__loss')!

  // Nothing to optimize if there are no parameters
  if (paramNames.length === 0) {
    subTape.forward(new Map([['__targetX', targetX], ['__targetY', targetY]]))
    const ptXIdx = subTape.paramIndices.get('__ptX')
    const ptYIdx = subTape.paramIndices.get('__ptY')
    return {
      x: ptXIdx != null ? subTape.nodes[ptXIdx].primal : targetX,
      y: ptYIdx != null ? subTape.nodes[ptYIdx].primal : targetY,
    }
  }

  const sliders = useStore.getState().sliders
  const x0 = paramNames.map((n) =>
    sliders.find((s) => s.name === n)?.value ?? session.initialParams.get(n) ?? 0,
  )

  const lowerBounds = paramNames.map((n) => {
    const s = sliders.find((sl) => sl.name === n)
    return s ? s.min : -Infinity
  })
  const upperBounds = paramNames.map((n) => {
    const s = sliders.find((sl) => sl.name === n)
    return s ? s.max : Infinity
  })

  const params = new Map<string, number>()

  const opt = new nlopt.Optimize(nlopt.Algorithm.LD_SLSQP, paramNames.length)
  opt.setMinObjective((x, grad) => {
    for (let i = 0; i < paramNames.length; i++) {
      params.set(paramNames[i], x[i])
    }
    params.set('__targetX', targetX)
    params.set('__targetY', targetY)

    subTape.forward(params)
    const lossVal = subTape.nodes[lossIdx].primal

    if (grad) {
      subTape.reset()
      subTape.backward(lossIdx)
      for (let i = 0; i < paramNames.length; i++) {
        grad[i] = subTape.grad(paramNames[i])
      }
    }
    return lossVal
  }, 1e-8)

  opt.setLowerBounds(lowerBounds)
  opt.setUpperBounds(upperBounds)
  opt.setMaxeval(200)

  const result = opt.optimize(x0)
  nlopt.GC.flush()

  // Read the optimized point from the sub-tape (forward was last called with optimal x)
  const ptXIdx = subTape.paramIndices.get('__ptX')
  const ptYIdx = subTape.paramIndices.get('__ptY')
  const ptX = ptXIdx != null ? subTape.nodes[ptXIdx].primal : targetX
  const ptY = ptYIdx != null ? subTape.nodes[ptYIdx].primal : targetY

  // Update slider values and re-execute the program for display
  const store = useStore.getState()
  for (let i = 0; i < paramNames.length; i++) {
    store.setSliderValue(paramNames[i], result.x[i])
  }
  rerunProgram()

  return { x: ptX, y: ptY }
}
