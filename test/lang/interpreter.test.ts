import { describe, it, expect } from 'vitest'
import { parse } from '@/lang/parser'
import { executeProgram } from '@/lang/interpreter'
import type { Value } from '@/lang/values'

function run(src: string, paramValues?: Map<string, number>) {
  const program = parse(src)
  return executeProgram(program, paramValues)
}

// Helper: run a program, return the draw buffer
function drawn(src: string) {
  return run(src).drawBuffer
}

// Helper: run and expect no error
function runOk(src: string) {
  const result = run(src)
  expect(result.error).toBeNull()
  return result
}

// ---------------------------------------------------------------------------
// Basic arithmetic & variables
// ---------------------------------------------------------------------------

describe('arithmetic', () => {
  it('draws nothing from pure arithmetic', () => {
    const buf = drawn('parameters {}\nx = 2 + 3')
    expect(buf.points).toHaveLength(0)
    expect(buf.edges).toHaveLength(0)
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

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

describe('parameters', () => {
  it('injects parameter mid values into context', () => {
    const result = runOk(`parameters {
  r: 10
}
draw(pt(r, 0))`)
    expect(result.drawBuffer.points).toEqual([{ x: 10, y: 0 }])
  })

  it('uses provided parameter values over mid', () => {
    const result = run(
      `parameters { r: 5 }\ndraw(pt(r, 0))`,
      new Map([['r', 20]]),
    )
    expect(result.error).toBeNull()
    expect(result.drawBuffer.points).toEqual([{ x: 20, y: 0 }])
  })

  it('parses parameter bounds', () => {
    const result = runOk(`parameters {
  x: 1 < 5 < 10
}
draw(pt(x, 0))`)
    expect(result.drawBuffer.points).toEqual([{ x: 5, y: 0 }])
  })
})

// ---------------------------------------------------------------------------
// pt() builtin
// ---------------------------------------------------------------------------

describe('pt()', () => {
  it('creates a point and draws it', () => {
    const buf = drawn('parameters {}\ndraw(pt(3, 4))')
    expect(buf.points).toEqual([{ x: 3, y: 4 }])
  })

  it('supports expressions as arguments', () => {
    const buf = drawn('parameters {}\ndraw(pt(1 + 2, 3 * 4))')
    expect(buf.points).toEqual([{ x: 3, y: 12 }])
  })
})

// ---------------------------------------------------------------------------
// rect() builtin
// ---------------------------------------------------------------------------

describe('rect()', () => {
  it('creates rectangle from x,y,w,h and draws edges', () => {
    const buf = drawn('parameters {}\ndraw(rect(0, 0, 10, 5))')
    expect(buf.edges).toHaveLength(4)
    expect(buf.points).toHaveLength(0) // rect only draws edges
  })

  it('creates rectangle from two points', () => {
    const buf = drawn('parameters {}\ndraw(rect(pt(0,0), pt(10,5)))')
    expect(buf.edges).toHaveLength(4)
  })

  it('edge coordinates are correct', () => {
    const buf = drawn('parameters {}\ndraw(rect(0, 0, 10, 5))')
    // bottom: (0,0) -> (10,0)
    expect(buf.edges[0]).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    // right: (10,0) -> (10,5)
    expect(buf.edges[1]).toEqual({
      start: { x: 10, y: 0 },
      end: { x: 10, y: 5 },
    })
    // top: (10,5) -> (0,5)
    expect(buf.edges[2]).toEqual({
      start: { x: 10, y: 5 },
      end: { x: 0, y: 5 },
    })
    // left: (0,5) -> (0,0)
    expect(buf.edges[3]).toEqual({
      start: { x: 0, y: 5 },
      end: { x: 0, y: 0 },
    })
  })
})

// ---------------------------------------------------------------------------
// Property access
// ---------------------------------------------------------------------------

describe('property access', () => {
  it('accesses point x and y', () => {
    const buf = drawn(`parameters {}
p = pt(3, 4)
draw(pt(p.x, p.y))`)
    expect(buf.points).toEqual([{ x: 3, y: 4 }])
  })

  it('accesses rectangle vertices', () => {
    const buf = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.topLeft)
draw(r.bottomRight)`)
    expect(buf.points).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 0 },
    ])
  })

  it('accesses rectangle named edges', () => {
    const buf = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.top)`)
    expect(buf.edges).toHaveLength(1)
    expect(buf.edges[0]).toEqual({
      start: { x: 10, y: 5 },
      end: { x: 0, y: 5 },
    })
  })

  it('accesses rectangle width/height', () => {
    const buf = drawn(`parameters {}
r = rect(1, 2, 30, 40)
draw(pt(r.width, r.height))`)
    expect(buf.points).toEqual([{ x: 30, y: 40 }])
  })

  it('accesses edge start/end', () => {
    const buf = drawn(`parameters {}
r = rect(0, 0, 10, 5)
draw(r.top.start)
draw(r.top.end)`)
    expect(buf.points).toEqual([
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Lambda / function calls
// ---------------------------------------------------------------------------

describe('lambdas', () => {
  it('evaluates a lambda', () => {
    const buf = drawn(`parameters {}
f = (x, y) => pt(x + 1, y + 1)
draw(f(2, 3))`)
    expect(buf.points).toEqual([{ x: 3, y: 4 }])
  })

  it('single-param lambda', () => {
    const buf = drawn(`parameters {}
f = x => pt(x, x)
draw(f(7))`)
    expect(buf.points).toEqual([{ x: 7, y: 7 }])
  })

  it('lambda sees outer variables (dynamic scoping)', () => {
    const buf = drawn(`parameters {}
offset = 10
f = x => pt(x + offset, 0)
draw(f(5))`)
    expect(buf.points).toEqual([{ x: 15, y: 0 }])
  })

  it('lambda assignment does not mutate parent scope', () => {
    // After calling f, 'a' in the outer scope should still be 1
    const buf = drawn(`parameters {}
a = 1
f = x => a = x
f(99)
draw(pt(a, 0))`)
    expect(buf.points).toEqual([{ x: 1, y: 0 }])
  })
})

// ---------------------------------------------------------------------------
// operation (FnDefn)
// ---------------------------------------------------------------------------

describe('operation', () => {
  it('defines and calls a named function', () => {
    const buf = drawn(`parameters {}
operation makePoint(x, y) { pt(x, y) }
draw(makePoint(5, 6))`)
    expect(buf.points).toEqual([{ x: 5, y: 6 }])
  })
})

// ---------------------------------------------------------------------------
// and / or operators
// ---------------------------------------------------------------------------

describe('and / or', () => {
  it('and returns rhs when lhs is truthy', () => {
    const buf = drawn(`parameters {}
draw(pt(1 and 2, 0))`)
    expect(buf.points).toEqual([{ x: 2, y: 0 }])
  })

  it('and returns lhs when lhs is falsy', () => {
    const buf = drawn(`parameters {}
draw(pt(0 and 2, 0))`)
    expect(buf.points).toEqual([{ x: 0, y: 0 }])
  })

  it('or returns lhs when lhs is truthy', () => {
    const buf = drawn(`parameters {}
draw(pt(1 or 2, 0))`)
    expect(buf.points).toEqual([{ x: 1, y: 0 }])
  })

  it('or returns rhs when lhs is falsy', () => {
    const buf = drawn(`parameters {}
draw(pt(0 or 7, 0))`)
    expect(buf.points).toEqual([{ x: 7, y: 0 }])
  })
})

// ---------------------------------------------------------------------------
// draw() variadic
// ---------------------------------------------------------------------------

describe('draw()', () => {
  it('accepts multiple arguments', () => {
    const buf = drawn(`parameters {}
draw(pt(1,0), pt(2,0), pt(3,0))`)
    expect(buf.points).toHaveLength(3)
  })

  it('draws mixed types', () => {
    const buf = drawn(`parameters {}
draw(pt(1,1), rect(0,0,5,5))`)
    expect(buf.points).toHaveLength(1)
    expect(buf.edges).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Error handling: partial draw on error
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('returns partial draw buffer when program errors', () => {
    const result = run(`parameters {}
draw(pt(1,1))
x = undefined_var`)
    expect(result.error).not.toBeNull()
    expect(result.drawBuffer.points).toHaveLength(1)
  })

  it('reports undefined variable', () => {
    const result = run('parameters {}\nx = nope')
    expect(result.error).not.toBeNull()
    expect(result.error!.message).toContain('Undefined variable')
  })
})

// ---------------------------------------------------------------------------
// Variable shadowing / reassignment
// ---------------------------------------------------------------------------

describe('shadowing', () => {
  it('reassignment updates the variable', () => {
    const buf = drawn(`parameters {}
x = 1
x = 2
draw(pt(x, 0))`)
    expect(buf.points).toEqual([{ x: 2, y: 0 }])
  })
})
