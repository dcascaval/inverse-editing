import { type Expression, type Program, show } from '@/lang/ast'
import {
  type Value,
  type Point2,
  type Edge2,
  createNumber,
  createNull,
  asNumber,
  showValue,
} from '@/lang/values'
import { LineageGraph } from '@/lang/lineage'
import * as Query from '@/lang/query'
import { getProperty, makeBuiltins } from '@/lang/stdlib'


// Draw style
export type DrawStyle = {
  fill?: string
  stroke?: string
  opacity?: number
  dashed?: boolean
}

// Draw buffer — batched per draw() call

export type Polygon2 = {
  vertices: Point2[]
}

export type DrawBatch = {
  points: Point2[]
  edges: Edge2[]
  polygons: Polygon2[]
  style: DrawStyle
}

export type DrawBuffer = {
  batches: DrawBatch[]
}


// Context (scope chain)


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


// Evaluate


function evaluate(expr: Expression, ctx: Context, buf: DrawBuffer, g: LineageGraph): Value {
  switch (expr.type) {
    case 'Literal':
      return createNumber(expr.value)

    case 'Variable': {
      const v = ctx.lookup(expr.name)
      if (v === undefined) return { type: 'null', sourceText: expr.name }
      return v
    }

    case 'Assignment': {
      const val = evaluate(expr.expression, ctx, buf, g)
      ctx.assign(expr.target, val)
      return val
    }

    case 'BinOp': {
      const lhs = evaluate(expr.lhs, ctx, buf, g)
      const rhs = evaluate(expr.rhs, ctx, buf, g)

      if (expr.op === 'and') {
        if (lhs.type !== 'query' || rhs.type !== 'query')
          throw new Error(`'and' requires query operands, got ${lhs.type} and ${rhs.type}`)
        return { type: 'query', query: Query.and(lhs.query, rhs.query) }
      }
      if (expr.op === 'or') {
        if (lhs.type !== 'query' || rhs.type !== 'query')
          throw new Error(`'or' requires query operands, got ${lhs.type} and ${rhs.type}`)
        return { type: 'query', query: Query.or(lhs.query, rhs.query) }
      }

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
      const arg = evaluate(expr.argument, ctx, buf, g)
      if (expr.op === 'not') {
        if (arg.type !== 'query')
          throw new Error(`'not' requires a query operand, got ${arg.type}`)
        return { type: 'query', query: Query.not(arg.query) }
      }
      const n = asNumber(arg, `unary '${expr.op}'`)
      if (expr.op === '-') return createNumber(-n)
      if (expr.op === '+') return createNumber(+n)
      throw new Error(`Unknown unary operator: ${expr.op}`)
    }

    case 'PropertyAccess': {
      const obj = evaluate(expr.object, ctx, buf, g)
      return getProperty(obj, expr.property, g)
    }

    case 'Apply': {
      const callee = evaluate(expr.callee, ctx, buf, g)
      const args = expr.args.map((a) => evaluate(a, ctx, buf, g))

      if (callee.type === 'builtin') return callee.fn(args)

      if (callee.type === 'lambda') {
        ctx.push()
        try {
          for (let i = 0; i < callee.params.length; i++) {
            ctx.assign(callee.params[i], args[i] ?? createNull())
          }
          return evaluate(callee.body, ctx, buf, g)
        } finally {
          ctx.pop()
        }
      }

      throw new Error(`Cannot call ${callee.type} ${showValue(callee)}`)
    }

    case 'Lambda':
      return {
        type: 'lambda',
        params: expr.params,
        body: expr.body,
      }

    case 'Block': {
      let result: Value = createNull()
      for (const stmt of expr.statements) {
        result = evaluate(stmt, ctx, buf, g)
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


// Execute


export type ExecutionResult = {
  drawBuffer: DrawBuffer
  lineage: LineageGraph
  error: Error | null
}

export function executeProgram(
  program: Program,
  parameterValues?: Map<string, number>,
): ExecutionResult {
  const buf: DrawBuffer = { batches: [] }
  const g = new LineageGraph()
  const builtins = makeBuiltins(buf, g)
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
      evaluate(stmt, ctx, buf, g)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error = new Error(`${msg}\n  in: ${show(stmt)}`)
      break
    }
  }

  return { drawBuffer: buf, lineage: g, error }
}
