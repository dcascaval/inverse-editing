import { describe, it, expect } from 'vitest'
import { parse, parseExpression } from '@/lang/parser'
import { show } from '@/lang/ast'

// Shorthand: parse expression then show it
function s(input: string): string {
  return show(parseExpression(input))
}


// Literals & variables


describe('literals and variables', () => {
  it('parses integer literal', () => {
    expect(s('42')).toBe('42.00')
  })

  it('parses decimal literal', () => {
    expect(s('3.14')).toBe('3.14')
  })

  it('parses variable', () => {
    expect(s('foo')).toBe('foo')
  })

  it('parses underscore-prefixed variable', () => {
    expect(s('_bar')).toBe('_bar')
  })
})


// Arithmetic


describe('arithmetic', () => {
  it('parses addition', () => {
    expect(s('a + b')).toBe('(a + b)')
  })

  it('parses subtraction', () => {
    expect(s('a - b')).toBe('(a - b)')
  })

  it('parses multiplication', () => {
    expect(s('a * b')).toBe('(a * b)')
  })

  it('parses division', () => {
    expect(s('a / b')).toBe('(a / b)')
  })

  it('parses modulo', () => {
    expect(s('a % b')).toBe('(a % b)')
  })

  it('parses exponentiation', () => {
    expect(s('a ** b')).toBe('(a ** b)')
  })

  it('respects precedence: add vs mul', () => {
    expect(s('a + b * c')).toBe('(a + (b * c))')
  })

  it('respects precedence: mul vs power', () => {
    expect(s('a * b ** c')).toBe('(a * (b ** c))')
  })

  it('left-associates addition', () => {
    expect(s('a + b + c')).toBe('((a + b) + c)')
  })

  it('left-associates multiplication', () => {
    expect(s('a * b * c')).toBe('((a * b) * c)')
  })

  it('parenthesized expression overrides precedence', () => {
    expect(s('(a + b) * c')).toBe('((a + b) * c)')
  })
})


// Unary operators


describe('unary operators', () => {
  it('parses unary minus', () => {
    expect(s('-x')).toBe('(-x)')
  })

  it('parses unary plus', () => {
    expect(s('+x')).toBe('(+x)')
  })

  it('parses double negative', () => {
    expect(s('--x')).toBe('(-(-x))')
  })

  it('unary binds tighter than binary', () => {
    expect(s('-a + b')).toBe('((-a) + b)')
  })
})


// and / or operators


describe('and / or / not', () => {
  it('parses and', () => {
    expect(s('a and b')).toBe('(a and b)')
  })

  it('parses or', () => {
    expect(s('a or b')).toBe('(a or b)')
  })

  it('and binds tighter than or', () => {
    expect(s('a or b and c')).toBe('(a or (b and c))')
  })

  it('chains and', () => {
    expect(s('a and b and c')).toBe('((a and b) and c)')
  })

  it('not as unary operator', () => {
    expect(s('not a')).toBe('(not a)')
  })

  it('not binds tighter than and', () => {
    expect(s('a and not b')).toBe('(a and (not b))')
  })

  it('not binds tighter than or', () => {
    expect(s('a or not b')).toBe('(a or (not b))')
  })

  it('chained not', () => {
    expect(s('not not a')).toBe('(not (not a))')
  })
})


// Property access & function application


describe('property access and apply', () => {
  it('parses property access', () => {
    expect(s('a.b')).toBe('a.b')
  })

  it('parses chained property access', () => {
    expect(s('a.b.c')).toBe('a.b.c')
  })

  it('parses function call with no args', () => {
    expect(s('f()')).toBe('f()')
  })

  it('parses function call with one arg', () => {
    expect(s('f(x)')).toBe('f(x)')
  })

  it('parses function call with multiple args', () => {
    expect(s('f(x, y, z)')).toBe('f(x, y, z)')
  })

  it('parses method call', () => {
    expect(s('a.translate(0, 1)')).toBe('a.translate(0.00, 1.00)')
  })

  it('parses chained method calls', () => {
    expect(s('a.foo(1).bar(2)')).toBe('a.foo(1.00).bar(2.00)')
  })

  it('parses nested calls', () => {
    expect(s('f(g(x))')).toBe('f(g(x))')
  })

  it('property access on call result', () => {
    expect(s('f(x).y')).toBe('f(x).y')
  })

  it('dot access across newlines', () => {
    const program = parse('parameters {}\nfoo(a, b)\n.bar(c)')
    expect(show(program.statements[0])).toBe('foo(a, b).bar(c)')
  })
})


// Lambda


describe('lambda', () => {
  it('parses single-param lambda (no parens)', () => {
    expect(s('x => x')).toBe('(x) => x')
  })

  it('parses multi-param lambda', () => {
    expect(s('(a, b) => a + b')).toBe('(a, b) => (a + b)')
  })

  it('parses zero-param lambda', () => {
    expect(s('() => 1')).toBe('() => 1.00')
  })

  it('lambda as function argument', () => {
    expect(s('map(xs, x => x + 1)')).toBe('map(xs, (x) => (x + 1.00))')
  })
})


// Block


describe('block', () => {
  it('parses empty block', () => {
    expect(s('{}')).toBe('{}')
  })

  it('parses block with single expression', () => {
    expect(s('{ x }')).toBe('{x}')
  })

  it('parses block with multiple statements', () => {
    const prog = parseExpression('{\n  x\n  y\n}')
    expect(prog.type).toBe('Block')
    if (prog.type === 'Block') {
      expect(prog.statements).toHaveLength(2)
    }
  })
})


// FnDefn


describe('fnDefn', () => {
  it('parses operation definition', () => {
    const result = parseExpression('operation foo(a, b) { a + b }')
    expect(result.type).toBe('FnDefn')
    if (result.type === 'FnDefn') {
      expect(result.name).toBe('foo')
      expect(result.params).toEqual(['a', 'b'])
      expect(result.body).toHaveLength(1)
    }
  })
})


// Assignment


describe('assignment', () => {
  it('parses simple assignment', () => {
    const prog = parse('parameters {}\nx = 5')
    expect(prog.statements).toHaveLength(1)
    const stmt = prog.statements[0]
    expect(stmt.type).toBe('Assignment')
    if (stmt.type === 'Assignment') {
      expect(stmt.target).toBe('x')
      expect(show(stmt.expression)).toBe('5.00')
    }
  })

  it('parses assignment with complex rhs', () => {
    const prog = parse('parameters {}\nx = a + b * c')
    const stmt = prog.statements[0]
    expect(stmt.type).toBe('Assignment')
    if (stmt.type === 'Assignment') {
      expect(show(stmt.expression)).toBe('(a + (b * c))')
    }
  })
})


// Parameter block


describe('parameter block', () => {
  it('parses empty parameter block', () => {
    const prog = parse('parameters {}')
    expect(prog.parameters).not.toBeNull()
    expect(prog.parameters!.parameters).toEqual([])
  })

  it('parses single parameter', () => {
    const prog = parse('parameters {\n  holeR: 10\n}')
    expect(prog.parameters!.parameters).toEqual([
      { name: 'holeR', bounds: { min: 10, mid: 10, max: 10 } },
    ])
  })

  it('parses parameter with bounds', () => {
    const prog = parse('parameters {\n  offset: 12 < 17 < 25\n}')
    expect(prog.parameters!.parameters).toEqual([
      { name: 'offset', bounds: { min: 12, mid: 17, max: 25 } },
    ])
  })

  it('parses multiple parameters', () => {
    const prog = parse(`parameters {
      holeR: 10
      gap: 4
      offset: 12 < 17 < 25
      thk: 5.0
    }`)
    expect(prog.parameters!.parameters).toHaveLength(4)
    expect(prog.parameters!.parameters[0].name).toBe('holeR')
    expect(prog.parameters!.parameters[2].bounds).toEqual({
      min: 12,
      mid: 17,
      max: 25,
    })
  })
})


// Full programs


describe('full programs', () => {
  it('parses parameter block followed by statements', () => {
    const prog = parse(`parameters {
  holeR: 10
}
c = Circle(pt(0, 0), holeR)`)
    expect(prog.parameters).not.toBeNull()
    expect(prog.statements).toHaveLength(1)
    expect(prog.statements[0].type).toBe('Assignment')
  })

  it('parses the example program', () => {
    const prog = parse(`parameters {
  holeR: 10
  gap: 4
  lowerOffset: 12.0 < 17 < 25
  thk: 5
  h: 10.0
  pinR: 2.0
  outerOffset: 0.5
  softenR: 0.8
}
c = Circle(pt(0, 0), holeR)
t = Rectangle(pt(-tThk / 2, -tOut / 2), tThk, tOut)
tooth = t.translate(0, holeR)
cPointQuery = (from(t.right) or from(t.left)) and not(derivedFrom(t.bottom))
tooth = Chamfer(tooth, query(tooth.points, cPointQuery), tThk / 3)
nTeeth = 18
teeth = Tabulate(nTeeth, i => tooth.rotateDeg(pt(0, 0), 360 * (i / nTeeth)))
gear = UnionAll(c, teeth)
hex = Polygon(pt(0, 0), 6, hexR)
key = Rectangle(hex.edges(1).midpoint, 2, 1).translate(-1, -0.5)
gear = Difference(gear, Union(hex, key))
draw(Extrude3D(gear, 4.0), style(translucent))`)

    expect(prog.parameters).not.toBeNull()
    expect(prog.parameters!.parameters).toHaveLength(8)
    expect(prog.statements.length).toBeGreaterThanOrEqual(10)
  })

  it('handles comments', () => {
    const prog = parse(`parameters { } x = /* inline */ 5
// full line comment
y = 10`)
    expect(prog.statements).toHaveLength(2)
  })

  it('handles semicolons as separators', () => {
    const prog = parse('parameters { } x = 1; y = 2; f(x)')
    expect(prog.statements).toHaveLength(3)
  })
})
