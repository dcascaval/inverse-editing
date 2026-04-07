import { type Expression, type Program, show } from '@/lang/ast'
import { Matrix4 } from 'three'
import {
  type Value,
  type Point2Val,
  type Point2,
  type Edge2,
  createNumber,
  createNull,
  asNumeric,
  showValue,
} from '@/lang/values'
import type { NumericValue } from '@/lang/numeric'
import { real } from '@/lang/numeric'
import { Tape } from '@/lang/grad'
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
  holes?: Point2[][]
}

export type AnnotatedPoint2 = Point2 & {
  z?: number
  sourceX?: NumericValue
  sourceY?: NumericValue
}

export type AnnotatedEdge2 = {
  start: { x: number; y: number; z?: number }
  end: { x: number; y: number; z?: number }
  sourceStart?: Point2Val
  sourceEnd?: Point2Val
}

export type Point3 = { x: number; y: number; z: number }

/** A quad in 3D: 4 corners, rendered as 2 triangles. */
export type Quad3 = [Point3, Point3, Point3, Point3]

/** A planar 3D face: 2D polygon (with holes) + Matrix4 placement. */
export type PlanarFaceDraw = {
  polygon: Polygon2
  matrix: Matrix4
}

export type DrawBatch = {
  points: AnnotatedPoint2[]
  edges: AnnotatedEdge2[]
  polygons: Polygon2[]
  quads3: Quad3[]
  planarFaces3: PlanarFaceDraw[]
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
    // Exact match first
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name)
      if (v !== undefined) return v
    }
    // Case-insensitive fallback
    const lower = name.toLowerCase()
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      for (const [k, v] of this.scopes[i]) {
        if (k.toLowerCase() === lower) return v
      }
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

  /** Return all bindings in the topmost scope. */
  topScope(): Map<string, Value> {
    return new Map(this.scopes[this.scopes.length - 1])
  }
}


// Evaluate


function evaluate(expr: Expression, ctx: Context, buf: DrawBuffer, g: LineageGraph, tape: Tape | null): Value {
  switch (expr.type) {
    case 'Literal':
      return createNumber(expr.value, tape)

    case 'Variable': {
      const v = ctx.lookup(expr.name)
      if (v === undefined) return { type: 'null', sourceText: expr.name }
      return v
    }

    case 'Assignment': {
      const val = evaluate(expr.expression, ctx, buf, g, tape)
      ctx.assign(expr.target, val)
      return val
    }

    case 'BinOp': {
      const lhs = evaluate(expr.lhs, ctx, buf, g, tape)
      const rhs = evaluate(expr.rhs, ctx, buf, g, tape)

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

      const l = asNumeric(lhs, `left of '${expr.op}'`)
      const r = asNumeric(rhs, `right of '${expr.op}'`)
      switch (expr.op) {
        case '+': return createNumber(l.add(r))
        case '-': return createNumber(l.sub(r))
        case '*': return createNumber(l.mul(r))
        case '/': return createNumber(l.div(r))
        case '%': return createNumber(l.mod(r))
        case '**': return createNumber(l.pow(r))
        default: throw new Error(`Unknown operator: ${expr.op}`)
      }
    }

    case 'UnaryOp': {
      const arg = evaluate(expr.argument, ctx, buf, g, tape)
      if (expr.op === 'not') {
        if (arg.type !== 'query')
          throw new Error(`'not' requires a query operand, got ${arg.type}`)
        return { type: 'query', query: Query.not(arg.query) }
      }
      const n = asNumeric(arg, `unary '${expr.op}'`)
      if (expr.op === '-') return createNumber(n.neg())
      if (expr.op === '+') return createNumber(n)
      throw new Error(`Unknown unary operator: ${expr.op}`)
    }

    case 'PropertyAccess': {
      const obj = evaluate(expr.object, ctx, buf, g, tape)
      return getProperty(obj, expr.property, g)
    }

    case 'Apply': {
      const callee = evaluate(expr.callee, ctx, buf, g, tape)
      const args = expr.args.map((a) => evaluate(a, ctx, buf, g, tape))

      if (callee.type === 'builtin') return callee.fn(args)

      if (callee.type === 'lambda') {
        ctx.push()
        try {
          for (let i = 0; i < callee.params.length; i++) {
            ctx.assign(callee.params[i], args[i] ?? createNull())
          }
          return evaluate(callee.body, ctx, buf, g, tape)
        } finally {
          ctx.pop()
        }
      }

      if (callee.type === 'operation') {
        ctx.push()
        try {
          for (let i = 0; i < callee.params.length; i++) {
            ctx.assign(callee.params[i], args[i] ?? createNull())
          }
          for (const stmt of callee.body) {
            evaluate(stmt, ctx, buf, g, tape)
          }
          return { type: 'scope', bindings: ctx.topScope() }
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
        result = evaluate(stmt, ctx, buf, g, tape)
      }
      return result
    }

    case 'FnDefn': {
      const fn: Value = {
        type: 'operation',
        name: expr.name,
        params: expr.params,
        body: expr.body,
      }
      ctx.assign(expr.name, fn)
      return fn
    }
  }
}


// Execute


export type ExecutionMode = 'real' | 'dual'

export type ExecutionResult = {
  drawBuffer: DrawBuffer
  lineage: LineageGraph
  error: Error | null
  tape: Tape | null
}

export function executeProgram(
  program: Program,
  parameterValues?: Map<string, number>,
  mode: ExecutionMode = 'real',
): ExecutionResult {
  const buf: DrawBuffer = { batches: [] }
  const g = new LineageGraph()
  const builtins = makeBuiltins(buf, g)
  const ctx = new Context(builtins)

  const tape = mode === 'dual' ? new Tape() : null

  // Inject parameter values
  if (program.parameters) {
    for (const p of program.parameters.parameters) {
      const val = parameterValues?.get(p.name) ?? p.bounds.mid
      ctx.assign(p.name, createNumber(val, tape, p.name))
    }
  }

  let error: Error | null = null
  for (const stmt of program.statements) {
    try {
      evaluate(stmt, ctx, buf, g, tape)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error = new Error(`${msg}\n  in: ${show(stmt)}`)
      break
    }
  }

  return { drawBuffer: buf, lineage: g, error, tape }
}
