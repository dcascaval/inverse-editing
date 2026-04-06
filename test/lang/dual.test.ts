import { describe, it, expect } from 'vitest'
import { DualValue, dual, computeGradient, Tape, extractSubTape } from '@/lang/grad'


// Helpers

function vars(tape: Tape, ...values: number[]): DualValue[] {
  return values.map((v) => dual(tape, v))
}

function grad1(tape: Tape, output: DualValue, x: DualValue): number {
  tape.reset()
  tape.backward(output.index)
  return tape.adjoint(x.index)
}

function grad2(tape: Tape, output: DualValue, x: DualValue, y: DualValue): [number, number] {
  tape.reset()
  tape.backward(output.index)
  return [tape.adjoint(x.index), tape.adjoint(y.index)]
}


// Forward pass

describe('tape forward pass', () => {
  it('const nodes have correct primal', () => {
    const tape = new Tape()
    const x = dual(tape, 42)
    expect(x.primal).toBe(42)
    expect(x.toNumber()).toBe(42)
  })

  it('add computes correct primal', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 3, 4)
    expect(x.add(y).primal).toBe(7)
  })

  it('chain of operations computes correct primal', () => {
    const tape = new Tape()
    const [x] = vars(tape, 3)
    const one = dual(tape, 1)
    // (x+1)*(x-1) = 4*2 = 8
    const result = x.add(one).mul(x.sub(one))
    expect(result.primal).toBe(8)
  })

  it('all operations compute correct primals', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 6, 3)
    expect(x.sub(y).primal).toBe(3)
    expect(x.mul(y).primal).toBe(18)
    expect(x.div(y).primal).toBe(2)
    expect(x.mod(y).primal).toBe(0)
    expect(x.pow(y).primal).toBe(216)
    expect(x.neg().primal).toBe(-6)
    expect(x.neg().abs().primal).toBe(6)
    expect(x.min(y).primal).toBe(3)
    expect(x.max(y).primal).toBe(6)
  })
})


// Backward pass: individual ops

describe('tape backward: individual ops', () => {
  it('add: df/dx = 1, df/dy = 1', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 2, 3)
    const [dx, dy] = grad2(tape, x.add(y), x, y)
    expect(dx).toBe(1)
    expect(dy).toBe(1)
  })

  it('sub: df/dx = 1, df/dy = -1', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 5, 3)
    const [dx, dy] = grad2(tape, x.sub(y), x, y)
    expect(dx).toBe(1)
    expect(dy).toBe(-1)
  })

  it('mul at (3,4): df/dx = 4, df/dy = 3', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 3, 4)
    const [dx, dy] = grad2(tape, x.mul(y), x, y)
    expect(dx).toBe(4)
    expect(dy).toBe(3)
  })

  it('div at (6,3): df/dx = 1/3, df/dy = -2/3', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 6, 3)
    const [dx, dy] = grad2(tape, x.div(y), x, y)
    expect(dx).toBeCloseTo(1 / 3)
    expect(dy).toBeCloseTo(-6 / 9)
  })

  it('pow at x=5, y=2: df/dx = 10, df/dy = 25*ln(5)', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 5, 2)
    const [dx, dy] = grad2(tape, x.pow(y), x, y)
    expect(dx).toBeCloseTo(10)
    expect(dy).toBeCloseTo(25 * Math.log(5))
  })

  it('neg: df/dx = -1', () => {
    const tape = new Tape()
    const [x] = vars(tape, 7)
    expect(grad1(tape, x.neg(), x)).toBe(-1)
  })

  it('abs at x=-3: df/dx = -1; at x=3: df/dx = 1', () => {
    const t1 = new Tape()
    const [x1] = vars(t1, -3)
    expect(grad1(t1, x1.abs(), x1)).toBe(-1)

    const t2 = new Tape()
    const [x2] = vars(t2, 3)
    expect(grad1(t2, x2.abs(), x2)).toBe(1)
  })

  it('min at (2,5): df/dx = 1, df/dy = 0', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 2, 5)
    const [dx, dy] = grad2(tape, x.min(y), x, y)
    expect(dx).toBe(1)
    expect(dy).toBe(0)
  })

  it('min at (5,2): df/dx = 0, df/dy = 1', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 5, 2)
    const [dx, dy] = grad2(tape, x.min(y), x, y)
    expect(dx).toBe(0)
    expect(dy).toBe(1)
  })

  it('max at (5,2): df/dx = 1, df/dy = 0', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 5, 2)
    const [dx, dy] = grad2(tape, x.max(y), x, y)
    expect(dx).toBe(1)
    expect(dy).toBe(0)
  })

  it('mod at (7,3): df/dx = 1, df/dy = -2', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 7, 3)
    const [dx, dy] = grad2(tape, x.mod(y), x, y)
    expect(dx).toBe(1)
    expect(dy).toBe(-2) // -floor(7/3) = -2
  })
})


// Backward pass: chains

describe('tape backward: chains', () => {
  it('x*x at x=3: dx = 6 (adjoint accumulation)', () => {
    const tape = new Tape()
    const [x] = vars(tape, 3)
    // f(x) = x*x, f'(x) = 2x = 6
    expect(grad1(tape, x.mul(x), x)).toBe(6)
  })

  it('(x+1)*(x-1) at x=3: dx = 6', () => {
    const tape = new Tape()
    const [x] = vars(tape, 3)
    const one = dual(tape, 1)
    // f(x) = x^2 - 1, f'(x) = 2x = 6
    const result = x.add(one).mul(x.sub(one))
    expect(result.primal).toBe(8)
    expect(grad1(tape, result, x)).toBe(6)
  })

  it('(a+b)*(a-b) at (3,4): da = 6, db = -8', () => {
    const tape = new Tape()
    const [a, b] = vars(tape, 3, 4)
    // f = a^2 - b^2, df/da = 2a = 6, df/db = -2b = -8
    const result = a.add(b).mul(a.sub(b))
    expect(result.primal).toBe(-7)
    const [da, db] = grad2(tape, result, a, b)
    expect(da).toBe(6)
    expect(db).toBe(-8)
  })

  it('multi-step chain: ((x*x)+x) at x=4, dx = 9', () => {
    const tape = new Tape()
    const [x] = vars(tape, 4)
    // f(x) = x^2 + x, f'(x) = 2x + 1 = 9
    const result = x.mul(x).add(x)
    expect(result.primal).toBe(20)
    expect(grad1(tape, result, x)).toBe(9)
  })
})


// Tape reset

describe('tape reset', () => {
  it('reset zeros adjoints, allows re-running backward from different output', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 3, 4)
    const sum = x.add(y)
    const prod = x.mul(y)

    // Backward from sum
    tape.backward(sum.index)
    expect(tape.adjoint(x.index)).toBe(1)
    expect(tape.adjoint(y.index)).toBe(1)

    // Reset and backward from prod
    tape.reset()
    tape.backward(prod.index)
    expect(tape.adjoint(x.index)).toBe(4)
    expect(tape.adjoint(y.index)).toBe(3)
  })
})


// computeGradient utility

describe('computeGradient', () => {
  it('computes named parameter gradients', () => {
    const tape = new Tape()
    const [a, b] = vars(tape, 3, 4)
    const params = new Map([['a', a.index], ['b', b.index]])

    // f = a * b, df/da = 4, df/db = 3
    const result = a.mul(b)
    const grad = computeGradient(tape, result.index, params)
    expect(grad.get('a')).toBe(4)
    expect(grad.get('b')).toBe(3)
  })

  it('works with post-hoc tape extension', () => {
    const tape = new Tape()
    const [x] = vars(tape, 5)
    const params = new Map([['x', x.index]])

    // Simulate program output: y = x * x (primal = 25)
    const y = x.mul(x)

    // Post-hoc: construct loss = (y - 20)^2 without re-evaluating x*x
    const target = dual(tape, 20)
    const diff = y.sub(target)
    const loss = diff.mul(diff) // (25-20)^2 = 25

    expect(loss.primal).toBe(25)

    // d(loss)/dx = 2*(x^2 - 20) * 2x = 2*5*10 = 100
    const grad = computeGradient(tape, loss.index, params)
    expect(grad.get('x')).toBe(100)
  })
})


// SubTape: extraction and repeated forward/backward


describe('extractSubTape (returns Tape)', () => {
  it('extracts only reachable nodes', () => {
    const tape = new Tape()
    const params = new Map<string, number>()

    // x and y are parameters; z is unrelated
    const [x, y, z] = vars(tape, 3, 4, 100)
    params.set('x', x.index)
    params.set('y', y.index)
    // z is not a param but is on the tape

    const _unused = z.mul(z)   // not reachable from loss
    const loss = x.mul(y)      // only depends on x, y

    const sub = extractSubTape(tape, loss.index, params)
    // Should contain 3 nodes: x, y, x*y. NOT z or z*z.
    expect(sub.nodes.length).toBe(3)
  })

  it('forward recomputes primals with new param values', () => {
    const tape = new Tape()
    const [x] = vars(tape, 3)
    const params = new Map([['x', x.index]])

    const loss = x.mul(x) // x^2
    const sub = extractSubTape(tape, loss.index, params)

    // Original: x=3, loss=9
    expect(sub.forward(new Map([['x', 3]]))).toBe(9)
    // Updated: x=5, loss=25
    expect(sub.forward(new Map([['x', 5]]))).toBe(25)
  })

  it('backward computes correct gradients', () => {
    const tape = new Tape()
    const [x] = vars(tape, 3)
    const params = new Map([['x', x.index]])

    const loss = x.mul(x)
    const sub = extractSubTape(tape, loss.index, params)

    sub.forwardBackward(new Map([['x', 3]]))
    expect(sub.grad('x')).toBe(6)  // d(x^2)/dx = 2x = 6

    // Re-run with x=5 → d(x^2)/dx = 10
    sub.forwardBackward(new Map([['x', 5]]))
    expect(sub.grad('x')).toBe(10)
  })

  it('forwardBackward convenience method', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 3, 4)
    const params = new Map([['x', x.index], ['y', y.index]])

    const loss = x.mul(y) // f = x*y
    const sub = extractSubTape(tape, loss.index, params)

    const lossVal = sub.forwardBackward(new Map([['x', 3], ['y', 4]]))
    expect(lossVal).toBe(12)
    expect(sub.grad('x')).toBe(4)
    expect(sub.grad('y')).toBe(3)
  })

  it('works with post-hoc loss on program tape', () => {
    const tape = new Tape()
    const [x] = vars(tape, 5)
    const params = new Map([['x', x.index]])

    // Simulate: program computes y = x*x + x (20 nodes of irrelevant stuff could be here)
    const y = x.mul(x).add(x) // x=5 → 30

    // Post-hoc loss: (y - 20)^2
    const target = dual(tape, 20)
    const diff = y.sub(target)
    const loss = diff.mul(diff) // (30-20)^2 = 100

    const sub = extractSubTape(tape, loss.index, params)

    // Verify initial
    expect(sub.forwardBackward(new Map([['x', 5]]))).toBe(100)
    // d(loss)/dx = 2*(x^2+x-20)*(2x+1) = 2*10*11 = 220
    expect(sub.grad('x')).toBe(220)

    // Re-run with x=4: y=20, loss=0, grad=0
    expect(sub.forwardBackward(new Map([['x', 4]]))).toBe(0)
    expect(sub.grad('x')).toBe(0)
  })

  it('optimization loop converges', () => {
    const tape = new Tape()
    const [x] = vars(tape, 10)
    const params = new Map([['x', x.index]])

    // Loss: (x - 7)^2, minimum at x=7
    const target = dual(tape, 7)
    const diff = x.sub(target)
    const loss = diff.mul(diff)

    const sub = extractSubTape(tape, loss.index, params)
    const lr = 0.1
    const p = new Map([['x', 10]])

    for (let i = 0; i < 100; i++) {
      sub.forwardBackward(p)
      p.set('x', p.get('x')! - lr * sub.grad('x'))
    }

    expect(p.get('x')!).toBeCloseTo(7, 4)
  })

  it('multi-parameter optimization converges', () => {
    const tape = new Tape()
    const [a, b] = vars(tape, 0, 0)
    const params = new Map([['a', a.index], ['b', b.index]])

    // Loss: (a - 3)^2 + (b - 4)^2, minimum at (3, 4)
    const ta = dual(tape, 3)
    const tb = dual(tape, 4)
    const da = a.sub(ta)
    const db = b.sub(tb)
    const loss = da.mul(da).add(db.mul(db))

    const sub = extractSubTape(tape, loss.index, params)
    const lr = 0.1
    const p = new Map([['a', 0], ['b', 0]])

    for (let i = 0; i < 100; i++) {
      sub.forwardBackward(p)
      p.set('a', p.get('a')! - lr * sub.grad('a'))
      p.set('b', p.get('b')! - lr * sub.grad('b'))
    }

    expect(p.get('a')!).toBeCloseTo(3, 6)
    expect(p.get('b')!).toBeCloseTo(4, 6)
  })

  it('excludes unreachable parameters from gradients', () => {
    const tape = new Tape()
    const [x, y] = vars(tape, 3, 4)
    const params = new Map([['x', x.index], ['y', y.index]])

    // Loss only depends on x
    const loss = x.mul(x)
    const sub = extractSubTape(tape, loss.index, params)

    sub.forwardBackward(new Map([['x', 3]]))
    expect(sub.grad('x')).toBe(6)
    expect(sub.grad('y')).toBe(0) // y not reachable
  })
})
