import { describe, it, expect, beforeAll } from 'vitest'
import nlopt from '@/vendor/nlopt'

beforeAll(async () => {
  await nlopt.ready
})

describe('nlopt', () => {
  it('minimizes (x-1)^2 + (y-1)^2 to [1, 1]', () => {
    const opt = new nlopt.Optimize(nlopt.Algorithm.LD_SLSQP, 2)
    opt.setMinObjective((x, grad) => {
      if (grad) {
        grad[0] = 2 * (x[0] - 1)
        grad[1] = 2 * (x[1] - 1)
      }
      return (x[0] - 1) ** 2 + (x[1] - 1) ** 2
    }, 1e-8)

    const result = opt.optimize([5, 5])
    expect(result.success).toBe(true)
    expect(result.x[0]).toBeCloseTo(1, 8)
    expect(result.x[1]).toBeCloseTo(1, 8)
    expect(result.value).toBeCloseTo(0, 8)
    nlopt.GC.flush()
  })

  it('respects bounds', () => {
    const opt = new nlopt.Optimize(nlopt.Algorithm.LD_SLSQP, 2)
    opt.setMinObjective((x, grad) => {
      if (grad) {
        grad[0] = 2 * (x[0] - 1)
        grad[1] = 2 * (x[1] - 1)
      }
      return (x[0] - 1) ** 2 + (x[1] - 1) ** 2
    }, 1e-8)
    opt.setLowerBounds([2, 3])
    opt.setUpperBounds([10, 10])

    const result = opt.optimize([5, 5])
    expect(result.success).toBe(true)
    expect(result.x[0]).toBeCloseTo(2, 8)
    expect(result.x[1]).toBeCloseTo(3, 8)
    nlopt.GC.flush()
  })

  it('handles inequality constraint', () => {
    // Minimize x+y subject to x >= 2
    const opt = new nlopt.Optimize(nlopt.Algorithm.LD_SLSQP, 2)
    opt.setMinObjective((x, grad) => {
      if (grad) { grad[0] = 1; grad[1] = 1 }
      return x[0] + x[1]
    }, 1e-8)
    // Constraint: 2 - x[0] <= 0  (i.e. x[0] >= 2)
    opt.addInequalityConstraint((x, grad) => {
      if (grad) { grad[0] = -1; grad[1] = 0 }
      return 2 - x[0]
    }, 1e-8)
    opt.setLowerBounds([0, 0])

    const result = opt.optimize([5, 5])
    expect(result.success).toBe(true)
    expect(result.x[0]).toBeCloseTo(2, 6)
    expect(result.x[1]).toBeCloseTo(0, 6)
    nlopt.GC.flush()
  })
})
