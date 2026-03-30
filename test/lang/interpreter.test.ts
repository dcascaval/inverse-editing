import { describe, it, expect } from 'vitest'
import type { Point2 } from '@/lang/values'
import { run, runOk, drawn } from '@test/lib'


// Basic arithmetic & variables


describe('arithmetic', () => {
  it('draws nothing from pure arithmetic', () => {
    const { points, edges } = drawn('parameters {}\nx = 2 + 3')
    expect(points).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('evaluates without error', () => {
    runOk('parameters {}\nx = (2 + 3) * 4 - 1')
  })

  it('supports exponentiation', () => {
    runOk('parameters {}\nx = 2 ** 10')
  })

  it('supports modulo', () => {
    runOk('parameters {}\nx = 10 % 3')
  })

  it('supports unary minus', () => {
    runOk('parameters {}\nx = -5')
  })
})


// Parameters


describe('parameters', () => {
  it('injects parameter mid values into context', () => {
    const { points } = drawn(`parameters {
  r: 10
}
draw(pt(r, 0))`)
    expect(points).toEqual([{ x: 10, y: 0 }])
  })

  it('uses provided parameter values over mid', () => {
    const result = run(
      `parameters { r: 5 }\ndraw(pt(r, 0))`,
      new Map([['r', 20]]),
    )
    expect(result.error).toBeNull()
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    expect(pts).toEqual([{ x: 20, y: 0 }])
  })

  it('parses parameter bounds', () => {
    const { points } = drawn(`parameters {
  x: 1 < 5 < 10
}
draw(pt(x, 0))`)
    expect(points).toEqual([{ x: 5, y: 0 }])
  })
})


// pt() builtin


describe('pt()', () => {
  it('creates a point and draws it', () => {
    const { points } = drawn('parameters {}\ndraw(pt(3, 4))')
    expect(points).toEqual([{ x: 3, y: 4 }])
  })

  it('supports expressions as arguments', () => {
    const { points } = drawn('parameters {}\ndraw(pt(1 + 2, 3 * 4))')
    expect(points).toEqual([{ x: 3, y: 12 }])
  })
})


// rect() builtin


describe('rect()', () => {
  it('creates rectangle from x,y,w,h and draws edges', () => {
    const { edges, points } = drawn('parameters {}\ndraw(rect(0, 0, 10, 5))')
    expect(edges).toHaveLength(4)
    expect(points).toHaveLength(0)
  })

  it('creates rectangle from two points', () => {
    const { edges } = drawn('parameters {}\ndraw(rect(pt(0,0), pt(10,5)))')
    expect(edges).toHaveLength(4)
  })

  it('edge coordinates are correct', () => {
    const { edges } = drawn('parameters {}\ndraw(rect(0, 0, 10, 5))')
    expect(edges[0]).toEqual({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })
    expect(edges[1]).toEqual({ start: { x: 10, y: 0 }, end: { x: 10, y: 5 } })
    expect(edges[2]).toEqual({ start: { x: 10, y: 5 }, end: { x: 0, y: 5 } })
    expect(edges[3]).toEqual({ start: { x: 0, y: 5 }, end: { x: 0, y: 0 } })
  })
})


// Property access


describe('property access', () => {
  it('accesses point x and y', () => {
    const { points } = drawn(`parameters {}
p = pt(3, 4)
draw(pt(p.x, p.y))`)
    expect(points).toEqual([{ x: 3, y: 4 }])
  })

  it('accesses rectangle vertices', () => {
    const { points } = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.topLeft)
draw(r.bottomRight)`)
    expect(points).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 0 },
    ])
  })

  it('accesses rectangle named edges', () => {
    const { edges } = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.top)`)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toEqual({ start: { x: 10, y: 5 }, end: { x: 0, y: 5 } })
  })

  it('accesses rectangle width/height', () => {
    const { points } = drawn(`parameters {}
r = rect(1, 2, 30, 40)
draw(pt(r.width, r.height))`)
    expect(points).toEqual([{ x: 30, y: 40 }])
  })

  it('accesses edge start/end', () => {
    const { points } = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.top.start)
draw(r.top.end)`)
    expect(points).toEqual([
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])
  })
})


// Lambda / function calls


describe('lambdas', () => {
  it('evaluates a lambda', () => {
    const { points } = drawn(`parameters {}
f = (x, y) => pt(x + 1, y + 1)
draw(f(2, 3))`)
    expect(points).toEqual([{ x: 3, y: 4 }])
  })

  it('single-param lambda', () => {
    const { points } = drawn(`parameters {}
f = x => pt(x, x)
draw(f(7))`)
    expect(points).toEqual([{ x: 7, y: 7 }])
  })

  it('lambda sees outer variables (dynamic scoping)', () => {
    const { points } = drawn(`parameters {}
offset = 10
f = x => pt(x + offset, 0)
draw(f(5))`)
    expect(points).toEqual([{ x: 15, y: 0 }])
  })

  it('lambda assignment does not mutate parent scope', () => {
    const { points } = drawn(`parameters {}
a = 1
f = x => a = x
f(99)
draw(pt(a, 0))`)
    expect(points).toEqual([{ x: 1, y: 0 }])
  })
})


// operation (FnDefn)


describe('operation', () => {
  it('returns a scope with bindings accessible via dot access', () => {
    const { points } = drawn(`parameters {}
operation makePoint(x, y) { p = pt(x, y) }
result = makePoint(5, 6)
draw(result.p)`)
    expect(points).toEqual([{ x: 5, y: 6 }])
  })

  it('captures all assignments in the scope', () => {
    const { points } = drawn(`parameters {}
operation makePair(x) {
  a = pt(x, 0)
  b = pt(x, 1)
}
pair = makePair(3)
draw(pair.a)
draw(pair.b)`)
    expect(points).toEqual([{ x: 3, y: 0 }, { x: 3, y: 1 }])
  })
})


// and / or operators


describe('and / or', () => {
  it('and errors on non-query operands', () => {
    const result = run('parameters {}\n1 and 2')
    expect(result.error).not.toBeNull()
  })

  it('or errors on non-query operands', () => {
    const result = run('parameters {}\n1 or 2')
    expect(result.error).not.toBeNull()
  })
})


// draw() variadic & batching


describe('draw()', () => {
  it('accepts multiple geometry arguments in one batch', () => {
    const { points, batches } = drawn(`parameters {}
draw(pt(1,0), pt(2,0), pt(3,0))`)
    expect(points).toHaveLength(3)
    expect(batches).toHaveLength(1)
  })

  it('draws mixed types in one batch', () => {
    const { points, edges, batches } = drawn(`parameters {}
draw(pt(1,1), rect(0,0,5,5))`)
    expect(points).toHaveLength(1)
    expect(edges).toHaveLength(4)
    expect(batches).toHaveLength(1)
  })

  it('multiple draw calls create separate batches', () => {
    const { batches } = drawn(`parameters {}
draw(pt(1,0))
draw(pt(2,0))`)
    expect(batches).toHaveLength(2)
  })
})


// Styles


describe('styles', () => {
  it('color() sets fill on the batch', () => {
    const { batches } = drawn(`parameters {}
draw(rect(0,0,1,1), color(red))`)
    expect(batches).toHaveLength(1)
    expect(batches[0].style.fill).toBe('red')
  })

  it('stroke() sets stroke on the batch', () => {
    const { batches } = drawn(`parameters {}
draw(rect(0,0,1,1), stroke(blue))`)
    expect(batches[0].style.stroke).toBe('blue')
  })

  it('translucent() sets opacity', () => {
    const { batches } = drawn(`parameters {}
draw(rect(0,0,1,1), translucent(0.5))`)
    expect(batches[0].style.opacity).toBe(0.5)
  })

  it('dashed sets dashed flag', () => {
    const { batches } = drawn(`parameters {}
draw(rect(0,0,1,1), dashed)`)
    expect(batches[0].style.dashed).toBe(true)
  })

  it('multiple styles merge', () => {
    const { batches } = drawn(`parameters {}
draw(rect(0,0,1,1), color(gray), stroke(black), translucent(0.9), dashed)`)
    const s = batches[0].style
    expect(s.fill).toBe('gray')
    expect(s.stroke).toBe('black')
    expect(s.opacity).toBe(0.9)
    expect(s.dashed).toBe(true)
  })

  it('undefined variables resolve to strings for color names', () => {
    const result = run('parameters {}\nx = someColor')
    expect(result.error).toBeNull()
  })
})


// Error handling: partial draw on error


describe('error handling', () => {
  it('returns partial draw buffer when program errors', () => {
    const result = run(`parameters {}
draw(pt(1,1))
x = pt(nope + 1, 0)`)
    expect(result.error).not.toBeNull()
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    expect(pts).toHaveLength(1)
  })
})


// Variable shadowing / reassignment


describe('shadowing', () => {
  it('reassignment updates the variable', () => {
    const { points } = drawn(`parameters {}
x = 1
x = 2
draw(pt(x, 0))`)
    expect(points).toEqual([{ x: 2, y: 0 }])
  })
})


// Transforms


function approxPt(p: Point2, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 10)
  expect(p.y).toBeCloseTo(y, 10)
}

describe('transforms', () => {
  it('translateX shifts x', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 2).translateX(10))`)
    approxPt(points[0], 11, 2)
  })

  it('translateY shifts y', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 2).translateY(5))`)
    approxPt(points[0], 1, 7)
  })

  it('translate shifts both axes', () => {
    const { points } = drawn(`parameters {}
draw(pt(0, 0).translate(3, 4))`)
    approxPt(points[0], 3, 4)
  })

  it('scale from origin', () => {
    const { points } = drawn(`parameters {}
draw(pt(2, 3).scale(2))`)
    approxPt(points[0], 4, 6)
  })

  it('scale around center', () => {
    const { points } = drawn(`parameters {}
draw(pt(4, 0).scale(pt(2, 0), 3))`)
    approxPt(points[0], 8, 0)
  })

  it('rotate 90 degrees around origin', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 0).rotate(90))`)
    approxPt(points[0], 0, 1)
  })

  it('rotate 180 degrees', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 0).rotate(180))`)
    approxPt(points[0], -1, 0)
  })

  it('rotate around center', () => {
    const { points } = drawn(`parameters {}
draw(pt(2, 0).rotate(pt(1, 0), 90))`)
    approxPt(points[0], 1, 1)
  })

  it('mirror about x-axis (via two points)', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 2).mirror(pt(0, 0), pt(1, 0)))`)
    approxPt(points[0], 1, -2)
  })

  it('mirror about edge', () => {
    const { points } = drawn(`parameters {}
draw(pt(1, 2).mirror(edge(0, 0, 1, 0)))`)
    approxPt(points[0], 1, -2)
  })

  it('mirror about y-axis', () => {
    const { points } = drawn(`parameters {}
draw(pt(3, 1).mirror(pt(0, 0), pt(0, 1)))`)
    approxPt(points[0], -3, 1)
  })

  it('transforms edge point-wise', () => {
    const { edges } = drawn(`parameters {}
draw(edge(1, 0, 3, 0).translate(0, 5))`)
    approxPt(edges[0].start, 1, 5)
    approxPt(edges[0].end, 3, 5)
  })

  it('transforms rectangle point-wise', () => {
    const { edges } = drawn(`parameters {}
draw(rect(0, 0, 2, 2).translate(10, 10))`)
    expect(edges).toHaveLength(4)
    // bottom edge: (10,10)→(12,10)
    approxPt(edges[0].start, 10, 10)
    approxPt(edges[0].end, 12, 10)
  })

  it('chained transforms', () => {
    const { points } = drawn(`parameters {}
draw(pt(0, 0).translate(1, 0).translate(0, 1))`)
    approxPt(points[0], 1, 1)
  })

  it('does not mutate original', () => {
    const { points } = drawn(`parameters {}
p = pt(1, 1)
q = p.translate(10, 0)
draw(p)
draw(q)`)
    approxPt(points[0], 1, 1)
    approxPt(points[1], 11, 1)
  })
})
