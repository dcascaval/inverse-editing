import { useStore } from '@/store'
import type { Slider } from '@/store'
import type { Program } from '@/lang/ast'
import { parse } from '@/lang/parser'
import { type ExecutionMode, executeProgram } from '@/lang/interpreter'
import { resolveLocks } from '@/optimize/drag'

/** Nearest power of 10 strictly greater than |value|, minimum 10 */
function upperBound(value: number): number {
  const abs = Math.abs(value)
  if (abs <= 1) return 10
  return 10 ** Math.ceil(Math.log10(abs + 1))
}

/**
 * Sync sliders from a parsed parameter block.
 */
export function syncSliders(program: Program) {
  const existing = useStore.getState().sliders
  const sliders: Slider[] = program.parameters.parameters.map((p) => {
    const { min: pMin, mid, max: pMax } = p.bounds
    const explicit = pMin !== mid || pMax !== mid
    let min: number, max: number
    if (explicit) {
      min = pMin
      max = pMax
    } else if (mid < 0) {
      min = -upperBound(mid)
      max = 0
    } else if (mid < 1) {
      min = 0
      max = Math.max(1, upperBound(mid))
    } else {
      min = 1
      max = upperBound(mid)
    }
    const step = (max - min) / 100 || 0.01

    const prev = existing.find((s) => s.name === p.name)
    let value = prev?.value ?? mid
    if (value < min || value > max) value = mid

    return { name: p.name, min, max, step, value }
  })
  useStore.getState().setSliders(sliders)
}

function exec(code: string, sync: boolean, mode: ExecutionMode = 'dual') {
  const store = useStore.getState()

  try {
    const program = parse(code)
    if (sync) syncSliders(program)

    const paramValues = new Map<string, number>()
    for (const s of useStore.getState().sliders) {
      paramValues.set(s.name, s.value)
    }

    const { drawBuffer, lineage, error, tape } = executeProgram(program, paramValues, mode)
    store.setScene(drawBuffer.batches)
    store.setTape(tape)
    store.setLineage(lineage)

    // Re-resolve locks against the new lineage graph and tape
    if (lineage && tape) {
      const allEdges = drawBuffer.batches.flatMap((b) => b.edges)
      resolveLocks(allEdges, lineage, tape)
    }

    if (error) {
      store.setError(error.message)
    } else {
      store.setError(null)
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    store.setError(err.message)
    store.setScene([])
    store.setTape(null)
  }
}

/**
 * Parse, sync sliders, execute, and update scene + error state.
 */
export function runProgram(src?: string) {
  exec(src ?? useStore.getState().code, true)
}

/**
 * Re-execute without re-syncing sliders (for slider changes).
 */
export function rerunProgram() {
  exec(useStore.getState().code, false)
}
