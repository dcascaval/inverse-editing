import { describe, it, expect } from 'vitest'
import { parse } from '@/lang/parser'
import { executeProgram } from '@/lang/interpreter'
import type { AnnotatedPoint2, AnnotatedEdge2 } from '@/lang/interpreter'
import { DualValue, dual, computeGradient, extractSubTape } from '@/lang/grad'

// Helpers

function runDual(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  return executeProgram(program, paramValues, 'dual')
}

function runReal(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  return executeProgram(program, paramValues, 'real')
}

function drawnPoints(src: string, paramValues?: Map<string, number>): AnnotatedPoint2[] {
  const { drawBuffer } = runDual(src, paramValues)
  return drawBuffer.batches.flatMap((b) => b.points)
}

function drawnEdges(src: string, paramValues?: Map<string, number>): AnnotatedEdge2[] {
  const { drawBuffer } = runDual(src, paramValues)
  return drawBuffer.batches.flatMap((b) => b.edges)
}

/** Run backward from a DualValue and get gradient w.r.t. named parameter. */
function gradOf(result: ReturnType<typeof runDual>, dv: DualValue, param: string): number {
  const { tape, parameterNodes } = result
  const grad = computeGradient(tape!, dv.index, parameterNodes!)
  return grad.get(param)!
}


// Dual mode execution

describe('dual mode execution', () => {
  it('returns tape and parameterNodes in dual mode', () => {
    const result = runDual('parameters { x: 5 }\ndraw(pt(x, 0))')
    expect(result.tape).not.toBeNull()
    expect(result.parameterNodes).not.toBeNull()
    expect(result.parameterNodes!.has('x')).toBe(true)
  })

  it('returns tape: null in real mode', () => {
    const result = runReal('parameters { x: 5 }\ndraw(pt(x, 0))')
    expect(result.tape).toBeNull()
    expect(result.parameterNodes).toBeNull()
  })

  it('primal values match real mode', () => {
    const src = `parameters { x: 3 }
draw(pt(x * x + 1, x - 2))`
    const real = runReal(src)
    const d = runDual(src)

    const realPts = real.drawBuffer.batches.flatMap((b) => b.points)
    const dualPts = d.drawBuffer.batches.flatMap((b) => b.points)

    expect(dualPts[0].x).toBe(realPts[0].x)
    expect(dualPts[0].y).toBe(realPts[0].y)
  })
})


// Parameter gradients

describe('parameter gradients', () => {
  it('linear: d(x)/dx = 1', () => {
    const result = runDual('parameters { x: 5 }\ndraw(pt(x, 0))')
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    expect(gradOf(result, sx, 'x')).toBe(1)
  })

  it('quadratic: d(x*x)/dx = 2x = 6 at x=3', () => {
    const result = runDual('parameters { x: 3 }\ndraw(pt(x * x, 0))')
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    expect(gradOf(result, sx, 'x')).toBe(6)
  })

  it('two params: d(a+b)/da = 1, d(a+b)/db = 1, d(a*b)/da = b, d(a*b)/db = a', () => {
    const result = runDual(`parameters {
  a: 2
  b: 3
}
draw(pt(a + b, a * b))`)
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    const sy = pts[0].sourceY as DualValue

    // d(a+b)/da = 1, d(a+b)/db = 1
    expect(gradOf(result, sx, 'a')).toBe(1)
    expect(gradOf(result, sx, 'b')).toBe(1)

    // d(a*b)/da = b = 3, d(a*b)/db = a = 2
    expect(gradOf(result, sy, 'a')).toBe(3)
    expect(gradOf(result, sy, 'b')).toBe(2)
  })

  it('through rectangle construction: gradients of corners w.r.t. w', () => {
    const result = runDual('parameters { w: 10 }\ndraw(rect(0, 0, w, w))')
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // rect(0,0,w,w) → bottom edge: (0,0)→(w,0)
    const bottomEnd = edges[0].sourceEnd as unknown as { x: DualValue; y: DualValue }
    // d(bottomEnd.x)/dw = 1
    expect(gradOf(result, bottomEnd.x, 'w')).toBe(1)
    // d(bottomEnd.y)/dw = 0
    expect(gradOf(result, bottomEnd.y, 'w')).toBe(0)
  })

  it('expression with subtraction and division', () => {
    const result = runDual('parameters { x: 6 }\ndraw(pt(x / 2, x - 1))')
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    const sy = pts[0].sourceY as DualValue
    // d(x/2)/dx = 0.5
    expect(gradOf(result, sx, 'x')).toBeCloseTo(0.5)
    // d(x-1)/dx = 1
    expect(gradOf(result, sy, 'x')).toBe(1)
  })

  it('unary negation: d(-x)/dx = -1', () => {
    const result = runDual('parameters { x: 5 }\ndraw(pt(-x, 0))')
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    expect(gradOf(result, sx, 'x')).toBe(-1)
  })
})


// Post-hoc tape extension (the key use case)

describe('post-hoc tape extension', () => {
  it('compute distance-to-target gradient without re-evaluating program', () => {
    const result = runDual('parameters { x: 5 }\ndraw(pt(x * x, 0))')
    const { tape, parameterNodes } = result
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)

    // x*x = 25, target = 20
    const px = pts[0].sourceX as DualValue
    const target = dual(tape!, 20)
    const diff = px.sub(target)
    const loss = diff.mul(diff)  // (25 - 20)^2 = 25

    expect(loss.primal).toBe(25)

    // d(loss)/dx = 2*(x^2 - 20) * 2x = 2*5*10 = 100
    const grad = computeGradient(tape!, loss.index, parameterNodes!)
    expect(grad.get('x')).toBe(100)
  })

  it('L2 distance loss for a point', () => {
    const result = runDual(`parameters {
  x: 3
  y: 4
}
draw(pt(x, y))`)
    const { tape, parameterNodes } = result
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)

    // Target: (1, 1). Current: (3, 4).
    // L2^2 = (3-1)^2 + (4-1)^2 = 4 + 9 = 13
    const px = pts[0].sourceX as DualValue
    const py = pts[0].sourceY as DualValue
    const tx = dual(tape!, 1)
    const ty = dual(tape!, 1)
    const dx = px.sub(tx)
    const dy = py.sub(ty)
    const loss = dx.mul(dx).add(dy.mul(dy))

    expect(loss.primal).toBe(13)

    // d(loss)/dx = 2*(3-1) = 4, d(loss)/dy = 2*(4-1) = 6
    const grad = computeGradient(tape!, loss.index, parameterNodes!)
    expect(grad.get('x')).toBe(4)
    expect(grad.get('y')).toBe(6)
  })

  it('can compute gradients for multiple outputs via reset', () => {
    const result = runDual(`parameters { x: 3 }
draw(pt(x * x, x + 1))`)
    const { tape, parameterNodes } = result
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    const sx = pts[0].sourceX as DualValue
    const sy = pts[0].sourceY as DualValue

    // d(x*x)/dx = 6
    tape!.reset()
    tape!.backward(sx.index)
    expect(tape!.adjoint(parameterNodes!.get('x')!)).toBe(6)

    // d(x+1)/dx = 1
    tape!.reset()
    tape!.backward(sy.index)
    expect(tape!.adjoint(parameterNodes!.get('x')!)).toBe(1)
  })
})


// Draw buffer annotations

describe('draw buffer annotations', () => {
  it('annotated points carry sourceX and sourceY', () => {
    const pts = drawnPoints('parameters { x: 5 }\ndraw(pt(x, 0))')
    expect(pts[0].sourceX).toBeDefined()
    expect(pts[0].sourceY).toBeDefined()
  })

  it('annotated edges carry sourceStart and sourceEnd', () => {
    const edges = drawnEdges('parameters {}\ndraw(rect(0, 0, 10, 5))')
    expect(edges[0].sourceStart).toBeDefined()
    expect(edges[0].sourceEnd).toBeDefined()
    expect(edges[0].sourceStart!.x).toBeDefined()
    expect(edges[0].sourceStart!.y).toBeDefined()
  })

  it('source values are DualValue instances in dual mode', () => {
    const pts = drawnPoints('parameters { x: 5 }\ndraw(pt(x, 0))')
    expect(pts[0].sourceX).toBeInstanceOf(DualValue)
    expect(pts[0].sourceY).toBeInstanceOf(DualValue)
  })

  it('source values are not DualValue in real mode', () => {
    const { drawBuffer } = runReal('parameters { x: 5 }\ndraw(pt(x, 0))')
    const pts = drawBuffer.batches.flatMap((b) => b.points)
    // sourceX is RealValue, not DualValue
    expect(pts[0].sourceX).toBeDefined()
    expect(pts[0].sourceX).not.toBeInstanceOf(DualValue)
  })
})


// SubTape optimization through interpreter


describe('extractSubTape optimization through interpreter', () => {
  it('optimize a point toward a target', () => {
    const result = runDual(`parameters {
  x: 0
  y: 0
}
draw(pt(x, y))`)
    const { tape, parameterNodes } = result
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)

    // Build loss: L2^2 to target (3, 4)
    const px = pts[0].sourceX as DualValue
    const py = pts[0].sourceY as DualValue
    const dx = px.sub(dual(tape!, 3))
    const dy = py.sub(dual(tape!, 4))
    const loss = dx.mul(dx).add(dy.mul(dy))

    // Extract sub-tape and optimize
    const sub = extractSubTape(tape!, loss.index, parameterNodes!)
    const lr = 0.1
    const p = new Map([['x', 0], ['y', 0]])

    for (let i = 0; i < 100; i++) {
      sub.forwardBackward(p)
      p.set('x', p.get('x')! - lr * sub.grad('x'))
      p.set('y', p.get('y')! - lr * sub.grad('y'))
    }

    expect(p.get('x')!).toBeCloseTo(3, 4)
    expect(p.get('y')!).toBeCloseTo(4, 4)
  })

  it('sub-tape is smaller than full tape', () => {
    const result = runDual(`parameters { x: 5 }
a = x * x
b = x + 1
c = x - 1
d = a + b + c
draw(pt(a, d))`)
    const { tape, parameterNodes } = result
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)

    // Loss only depends on pt.x = x*x
    const px = pts[0].sourceX as DualValue
    const target = dual(tape!, 10)
    const loss = px.sub(target).pow(dual(tape!, 2))

    const sub = extractSubTape(tape!, loss.index, parameterNodes!)
    // Sub-tape should be much smaller than the full tape
    // Full tape has nodes for a, b, c, d, draw args, loss, etc.
    // Sub-tape only has: x, x*x, 10, 2, (x*x-10), (x*x-10)^2
    expect(sub.nodes.length).toBeLessThan(tape!.nodes.length)

    // But still gives correct gradients
    sub.forwardBackward(new Map([['x', 5]]))
    // d((x^2-10)^2)/dx = 2*(x^2-10)*2x = 2*15*10 = 300
    expect(sub.grad('x')).toBe(300)
  })

  it('optimize rect width to match target area', () => {
    const result = runDual(`parameters { w: 1 }
draw(rect(0, 0, w, w))`)
    const { tape, parameterNodes } = result

    // Target area = 25 → w should converge to 5
    // Area = w*w (from rect width * height, both are w)
    // We can get w via the rectangle's width annotation
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Bottom-right point x coord = w
    const wVal = edges[0].sourceEnd!.x as unknown as DualValue
    const area = wVal.mul(wVal) // w * w since rect is square
    const targetArea = dual(tape!, 25)
    const loss = area.sub(targetArea).pow(dual(tape!, 2))

    const sub = extractSubTape(tape!, loss.index, parameterNodes!)
    const lr = 0.001
    const p = new Map([['w', 1]])

    for (let i = 0; i < 500; i++) {
      sub.forwardBackward(p)
      p.set('w', p.get('w')! - lr * sub.grad('w'))
    }

    expect(p.get('w')!).toBeCloseTo(5, 1)
  })
})
