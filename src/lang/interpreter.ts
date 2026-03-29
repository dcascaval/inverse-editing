import type { Expression, Program } from '@/lang/ast'
import {
  type Value,
  type Point2,
  type Edge2,
  createNumber,
  NULL,
  createPooint,
  createRectangle,
  createEdge,
  isTruthy,
  asNumber,
  showValue,
} from '@/lang/values'

// ---------------------------------------------------------------------------
// Draw buffer
// ---------------------------------------------------------------------------

export interface DrawBuffer {
  points: Point2[]
  edges: Edge2[]
}

function pt2(p: { x: number; y: number }): Point2 {
  return { x: p.x, y: p.y }
}

function edge2(e: { start: { x: number; y: number }; end: { x: number; y: number } }): Edge2 {
  return { start: pt2(e.start), end: pt2(e.end) }
}

function collectDrawable(v: Value, buf: DrawBuffer) {
  switch (v.type) {
    case 'point2':
      buf.points.push(pt2(v))
      break
    case 'edge2':
      buf.edges.push(edge2(v))
      break
    case 'rectangle':
      for (const e of v.edges) buf.edges.push(edge2(e))
      break
  }
}

// ---------------------------------------------------------------------------
// Context (scope chain)
// ---------------------------------------------------------------------------

type Scope = Map<string, Value>

class Context {
  private scopes: Scope[]

  constructor(initial?: Scope) {
    this.scopes = [initial ?? new Map()]
  }

  lookup(name: string): Value | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name)
      if (v !== undefined) return v
    }
    return undefined
  }

  assign(name: string, value: Value) {
    this.scopes[this.scopes.length - 1].set(name, value)
  }

  push() {
    this.scopes.push(new Map())
  }

  pop() {
    this.scopes.pop()
  }
}

// ---------------------------------------------------------------------------
// Property access
// ---------------------------------------------------------------------------

function getProperty(obj: Value, prop: string): Value {
  switch (obj.type) {
    case 'point2':
      if (prop === 'x') return createNumber(obj.x)
      if (prop === 'y') return createNumber(obj.y)
      break
    case 'edge2':
      if (prop === 'start') return createPooint(obj.start.x, obj.start.y)
      if (prop === 'end') return createPooint(obj.end.x, obj.end.y)
      break
    case 'rectangle':
      switch (prop) {
        case 'x': return createNumber(obj.x)
        case 'y': return createNumber(obj.y)
        case 'width': return createNumber(obj.width)
        case 'height': return createNumber(obj.height)
        case 'topLeft': return obj.topLeft
        case 'topRight': return obj.topRight
        case 'bottomLeft': return obj.bottomLeft
        case 'bottomRight': return obj.bottomRight
        case 'top': return obj.top
        case 'bottom': return obj.bottom
        case 'left': return obj.left
        case 'right': return obj.right
        case 'points': return { type: 'array', elements: obj.points }
        case 'edges': return { type: 'array', elements: obj.edges }
      }
      break
    case 'array':
      if (prop === 'length') return createNumber(obj.elements.length)
      break
  }
  throw new Error(`No property '${prop}' on ${obj.type}`)
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

function evaluate(expr: Expression, ctx: Context, buf: DrawBuffer): Value {
  switch (expr.type) {
    case 'Literal':
      return createNumber(expr.value)

    case 'Variable': {
      const v = ctx.lookup(expr.name)
      if (v === undefined) throw new Error(`Undefined variable: ${expr.name}`)
      return v
    }

    case 'Assignment': {
      const val = evaluate(expr.expression, ctx, buf)
      ctx.assign(expr.target, val)
      return val
    }

    case 'BinOp': {
      const lhs = evaluate(expr.lhs, ctx, buf)
      const rhs = evaluate(expr.rhs, ctx, buf)

      if (expr.op === 'and') return isTruthy(lhs) ? rhs : lhs
      if (expr.op === 'or') return isTruthy(lhs) ? lhs : rhs

      const l = asNumber(lhs, `left of '${expr.op}'`)
      const r = asNumber(rhs, `right of '${expr.op}'`)
      switch (expr.op) {
        case '+': return createNumber(l + r)
        case '-': return createNumber(l - r)
        case '*': return createNumber(l * r)
        case '/': return createNumber(l / r)
        case '%': return createNumber(l % r)
        case '**': return createNumber(l ** r)
        default: throw new Error(`Unknown operator: ${expr.op}`)
      }
    }

    case 'UnaryOp': {
      const arg = evaluate(expr.argument, ctx, buf)
      const n = asNumber(arg, `unary '${expr.op}'`)
      if (expr.op === '-') return createNumber(-n)
      if (expr.op === '+') return createNumber(+n)
      throw new Error(`Unknown unary operator: ${expr.op}`)
    }

    case 'PropertyAccess': {
      const obj = evaluate(expr.object, ctx, buf)
      return getProperty(obj, expr.property)
    }

    case 'Apply': {
      const callee = evaluate(expr.callee, ctx, buf)
      const args = expr.args.map((a) => evaluate(a, ctx, buf))

      if (callee.type === 'builtin') return callee.fn(args)

      if (callee.type === 'lambda') {
        ctx.push()
        try {
          for (let i = 0; i < callee.params.length; i++) {
            ctx.assign(callee.params[i], args[i] ?? NULL)
          }
          return evaluate(callee.body, ctx, buf)
        } finally {
          ctx.pop()
        }
      }

      throw new Error(`Cannot call ${callee.type}`)
    }

    case 'Lambda':
      return {
        type: 'lambda',
        params: expr.params,
        body: expr.body,
      }

    case 'Block': {
      let result: Value = NULL
      for (const stmt of expr.statements) {
        result = evaluate(stmt, ctx, buf)
      }
      return result
    }

    case 'FnDefn': {
      const fn: Value = {
        type: 'lambda',
        params: expr.params,
        body: { type: 'Block', statements: expr.body },
      }
      ctx.assign(expr.name, fn)
      return fn
    }
  }
}

// ---------------------------------------------------------------------------
// Builtins
// ---------------------------------------------------------------------------

function makeBuiltins(buf: DrawBuffer): Scope {
  const scope: Scope = new Map()

  function def(name: string, fn: (args: Value[]) => Value) {
    scope.set(name, { type: 'builtin', name, fn })
  }

  def('pt', (args) => {
    const x = asNumber(args[0], 'pt arg 0')
    const y = asNumber(args[1], 'pt arg 1')
    return createPooint(x, y)
  })

  def('rect', (args) => {
    if (args.length >= 4) {
      const x = asNumber(args[0], 'rect arg 0')
      const y = asNumber(args[1], 'rect arg 1')
      const w = asNumber(args[2], 'rect arg 2')
      const h = asNumber(args[3], 'rect arg 3')
      return createRectangle(x, y, w, h)
    }
    if (args.length === 2 && args[0].type === 'point2' && args[1].type === 'point2') {
      const p1 = args[0]
      const p2 = args[1]
      const x = Math.min(p1.x, p2.x)
      const y = Math.min(p1.y, p2.y)
      const w = Math.abs(p2.x - p1.x)
      const h = Math.abs(p2.y - p1.y)
      return createRectangle(x, y, w, h)
    }
    throw new Error('rect() expects (x,y,w,h) or (point, point)')
  })

  def('edge', (args) => {
    if (args.length === 2 && args[0].type === 'point2' && args[1].type === 'point2') {
      return createEdge(args[0], args[1])
    }
    if (args.length === 4) {
      return createEdge(
        { x: asNumber(args[0], 'edge x1'), y: asNumber(args[1], 'edge y1') },
        { x: asNumber(args[2], 'edge x2'), y: asNumber(args[3], 'edge y2') },
      )
    }
    throw new Error('edge() expects (point, point) or (x1,y1,x2,y2)')
  })

  def('draw', (args) => {
    for (const a of args) collectDrawable(a, buf)
    return NULL
  })

  return scope
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  drawBuffer: DrawBuffer
  error: Error | null
}

export function executeProgram(
  program: Program,
  parameterValues?: Map<string, number>,
): ExecutionResult {
  const buf: DrawBuffer = { points: [], edges: [] }
  const builtins = makeBuiltins(buf)
  const ctx = new Context(builtins)

  // Inject parameter values
  if (program.parameters) {
    for (const p of program.parameters.parameters) {
      const val = parameterValues?.get(p.name) ?? p.bounds.mid
      ctx.assign(p.name, createNumber(val))
    }
  }

  let error: Error | null = null
  for (const stmt of program.statements) {
    try {
      evaluate(stmt, ctx, buf)
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
      break
    }
  }

  return { drawBuffer: buf, error }
}
