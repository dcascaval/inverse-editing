import { type Expression, type Program, show } from '@/lang/ast'
import {
  type Value,
  type Point2,
  type Edge2,
  type StyleVal,
  createNumber,
  NULL,
  createPooint,
  createRectangle,
  createEdge,
  isTruthy,
  asNumber,
  asString,
  showValue,
} from '@/lang/values'
import { overloaded, sig, Num, Pt2 } from '@/lang/overload'
import {
  transformValue,
  translationMatrix,
  rotateXMatrix,
  rotateYMatrix,
  rotateXAroundMatrix,
  rotateYAroundMatrix,
  scaleMatrix,
  scaleAroundMatrix,
  mirrorMatrix,
} from '@/lang/transform'

// ---------------------------------------------------------------------------
// Draw style
// ---------------------------------------------------------------------------

export interface DrawStyle {
  fill?: string
  stroke?: string
  opacity?: number
  dashed?: boolean
}

// ---------------------------------------------------------------------------
// Draw buffer — batched per draw() call
// ---------------------------------------------------------------------------

export interface Polygon2 {
  vertices: Point2[]
}

export interface DrawBatch {
  points: Point2[]
  edges: Edge2[]
  polygons: Polygon2[]
  style: DrawStyle
}

export interface DrawBuffer {
  batches: DrawBatch[]
}

function pt2(p: { x: number; y: number }): Point2 {
  return { x: p.x, y: p.y }
}

function edge2(e: { start: { x: number; y: number }; end: { x: number; y: number } }): Edge2 {
  return { start: pt2(e.start), end: pt2(e.end) }
}

function collectDrawable(v: Value, batch: DrawBatch) {
  switch (v.type) {
    case 'point2':
      batch.points.push(pt2(v))
      break
    case 'edge2':
      batch.edges.push(edge2(v))
      break
    case 'rectangle':
      for (const e of v.edges) batch.edges.push(edge2(e))
      batch.polygons.push({ vertices: v.points.map(pt2) })
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

function isGeometric(v: Value): boolean {
  return v.type === 'point2' || v.type === 'edge2' || v.type === 'rectangle'
}

function makeTransformMethod(obj: Value, name: string): Value {
  return {
    type: 'builtin',
    name: `${obj.type}.${name}`,
    fn: (args: Value[]) => {
      switch (name) {
        case 'translateX':
          return transformValue(translationMatrix(asNumber(args[0], 'translateX'), 0), obj)
        case 'translateY':
          return transformValue(translationMatrix(0, asNumber(args[0], 'translateY')), obj)
        case 'translate':
          return transformValue(
            translationMatrix(asNumber(args[0], 'translate x'), asNumber(args[1], 'translate y')),
            obj,
          )
        case 'rotateX': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(rotateXAroundMatrix(args[0], asNumber(args[1], 'rotateX deg')), obj)
          }
          return transformValue(rotateXMatrix(asNumber(args[0], 'rotateX deg')), obj)
        }
        case 'rotateY': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(rotateYAroundMatrix(args[0], asNumber(args[1], 'rotateY deg')), obj)
          }
          return transformValue(rotateYMatrix(asNumber(args[0], 'rotateY deg')), obj)
        }
        case 'scale': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(scaleAroundMatrix(args[0], asNumber(args[1], 'scale factor')), obj)
          }
          return transformValue(scaleMatrix(asNumber(args[0], 'scale factor')), obj)
        }
        case 'mirror': {
          if (args.length >= 2 && args[0].type === 'point2' && args[1].type === 'point2') {
            return transformValue(mirrorMatrix(args[0], args[1]), obj)
          }
          if (args.length >= 1 && args[0].type === 'edge2') {
            return transformValue(mirrorMatrix(args[0].start, args[0].end), obj)
          }
          throw new Error('mirror: expected (edge) or (point, point)')
        }
        default:
          throw new Error(`Unknown transform method: ${name}`)
      }
    },
  }
}

const transformMethods = new Set([
  'translateX', 'translateY', 'translate',
  'rotateX', 'rotateY',
  'scale', 'mirror',
])

function getProperty(obj: Value, prop: string): Value {
  if (isGeometric(obj) && transformMethods.has(prop)) {
    return makeTransformMethod(obj, prop)
  }

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
      // Undefined variables resolve to their name as a string
      if (v === undefined) return { type: 'null', sourceText: expr.name }
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

      throw new Error(`Cannot call ${callee.type} ${showValue(callee)}`)
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

  scope.set('pt', overloaded('pt', [
    sig([Num, Num], (x, y) => createPooint(x.value, y.value)),
  ]))

  scope.set('rect', overloaded('rect', [
    sig([Num, Num, Num, Num], (x, y, w, h) =>
      createRectangle(x.value, y.value, w.value, h.value)),
    sig([Pt2, Pt2], (p1, p2) =>
      createRectangle(
        Math.min(p1.x, p2.x),
        Math.min(p1.y, p2.y),
        Math.abs(p2.x - p1.x),
        Math.abs(p2.y - p1.y),
      )),
  ]))

  scope.set('edge', overloaded('edge', [
    sig([Pt2, Pt2], (p1, p2) => createEdge(p1, p2)),
    sig([Num, Num, Num, Num], (x1, y1, x2, y2) =>
      createEdge({ x: x1.value, y: y1.value }, { x: x2.value, y: y2.value })),
  ]))

  // Style builtins — accept null values with sourceText (e.g. color(red))
  scope.set('color', {
    type: 'builtin',
    name: 'color',
    fn: (args: Value[]) => {
      if (args.length !== 1) throw new Error('color: expected 1 argument')
      const s = asString(args[0], 'color')
      return { type: 'style', fill: s } satisfies StyleVal
    },
  })

  scope.set('stroke', {
    type: 'builtin',
    name: 'stroke',
    fn: (args: Value[]) => {
      if (args.length !== 1) throw new Error('stroke: expected 1 argument')
      const s = asString(args[0], 'stroke')
      return { type: 'style', stroke: s } satisfies StyleVal
    },
  })

  scope.set('translucent', overloaded('translucent', [
    sig([Num], (n): StyleVal => ({ type: 'style', opacity: n.value })),
  ]))

  // draw is variadic: draw(geom..., style...)
  scope.set('draw', {
    type: 'builtin',
    name: 'draw',
    fn: (args: Value[]) => {
      const batch: DrawBatch = { points: [], edges: [], polygons: [], style: {} }
      for (const a of args) {
        if (a.type === 'style') {
          if (a.fill !== undefined) batch.style.fill = a.fill
          if (a.stroke !== undefined) batch.style.stroke = a.stroke
          if (a.opacity !== undefined) batch.style.opacity = a.opacity
          if (a.dashed !== undefined) batch.style.dashed = a.dashed
        } else if (a.type === 'null' && a.sourceText === 'dashed') {
          batch.style.dashed = true
        } else {
          collectDrawable(a, batch)
        }
      }
      if (batch.points.length > 0 || batch.edges.length > 0) {
        buf.batches.push(batch)
      }
      return NULL
    },
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
  const buf: DrawBuffer = { batches: [] }
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
      const msg = e instanceof Error ? e.message : String(e)
      error = new Error(`${msg}\n  in: ${show(stmt)}`)
      break
    }
  }

  return { drawBuffer: buf, error }
}
