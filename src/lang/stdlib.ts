import {
  type Value,
  type Point2,
  type Edge2,
  type StyleVal,
  createNumber,
  createNull,
  createPoint,
  constructRectangle,
  createEdge,
  asNumber,
  asString,
  showValue,
} from '@/lang/values'
import type { NumericValue } from '@/lang/numeric'
import { overloaded, signature, Num, Pt2, Rct, Pgn } from '@/lang/overload'
import {
  transformValue,
  translationMatrix,
  rotateMatrix,
  rotateAroundMatrix,
  scaleMatrix,
  scaleAroundMatrix,
  mirrorMatrix,
} from '@/geometry/transform'
import type { LineageGraph } from '@/lang/lineage'
import * as Query from '@/lang/query'
import type { DrawBatch, DrawBuffer } from '@/lang/interpreter'
import { type BooleanOp, booleanOperation } from '@/geometry/boolean'
import { distributeHoles } from '@/geometry/polygon'


// Draw helpers

function pt2(p: { x: NumericValue; y: NumericValue }): Point2 {
  return { x: p.x.toNumber(), y: p.y.toNumber() }
}

function edge2(e: { start: { x: NumericValue; y: NumericValue }; end: { x: NumericValue; y: NumericValue } }): Edge2 {
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
    case 'polygon':
      for (const e of v.edges) batch.edges.push(edge2(e))
      batch.polygons.push({ vertices: v.points.map(pt2) })
      break
    case 'region': {
      for (const poly of distributeHoles(v)) batch.polygons.push(poly)
      for (const p of [...v.positive, ...v.negative]) {
        for (const e of p.edges) batch.edges.push(edge2(e))
      }
      break
    }
    case 'array':
      for (const el of v.elements) collectDrawable(el, batch)
      break
  }
}


// Property access


function isGeometric(v: Value): boolean {
  return v.type === 'point2' || v.type === 'edge2' || v.type === 'rectangle'
    || v.type === 'polygon' || v.type === 'region'
}

function makeTransformMethod(obj: Value, name: string, g: LineageGraph): Value {
  return {
    type: 'builtin',
    name: `${obj.type}.${name}`,
    fn: (args: Value[]) => {
      switch (name) {
        case 'translateX':
          return transformValue(translationMatrix(asNumber(args[0], 'translateX'), 0), obj, g)
        case 'translateY':
          return transformValue(translationMatrix(0, asNumber(args[0], 'translateY')), obj, g)
        case 'translate':
          return transformValue(
            translationMatrix(asNumber(args[0], 'translate x'), asNumber(args[1], 'translate y')),
            obj, g,
          )
        case 'rotate': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(rotateAroundMatrix(args[0], asNumber(args[1], 'rotate deg')), obj, g)
          }
          return transformValue(rotateMatrix(asNumber(args[0], 'rotate deg')), obj, g)
        }
        case 'scale': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(scaleAroundMatrix(args[0], asNumber(args[1], 'scale factor')), obj, g)
          }
          return transformValue(scaleMatrix(asNumber(args[0], 'scale factor')), obj, g)
        }
        case 'mirror': {
          if (args.length >= 2 && args[0].type === 'point2' && args[1].type === 'point2') {
            return transformValue(mirrorMatrix(args[0], args[1]), obj, g)
          }
          if (args.length >= 1 && args[0].type === 'edge2') {
            return transformValue(mirrorMatrix(args[0].start, args[0].end), obj, g)
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
  'rotate',
  'scale', 'mirror',
])

export function getProperty(obj: Value, prop: string, g: LineageGraph): Value {
  if (isGeometric(obj) && transformMethods.has(prop)) {
    return makeTransformMethod(obj, prop, g)
  }

  switch (obj.type) {
    case 'point2':
      if (prop === 'x') return createNumber(obj.x)
      if (prop === 'y') return createNumber(obj.y)
      break
    case 'edge2':
      if (prop === 'start') return obj.start
      if (prop === 'end') return obj.end
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
    case 'polygon':
      if (prop === 'points') return { type: 'array', elements: obj.points }
      if (prop === 'edges') return { type: 'array', elements: obj.edges }
      break
    case 'region': {
      if (prop === 'positive') return { type: 'array', elements: obj.positive }
      if (prop === 'negative') return { type: 'array', elements: obj.negative }
      const allPolys = [...obj.positive, ...obj.negative]
      if (prop === 'points') return { type: 'array', elements: allPolys.flatMap((p) => p.points) }
      if (prop === 'edges') return { type: 'array', elements: allPolys.flatMap((p) => p.edges) }
      if (prop === 'single') return {
        type: 'builtin', name: 'region.single',
        fn: () => {
          if (obj.positive.length !== 1)
            throw new Error(`single: expected region with 1 positive polygon, got ${obj.positive.length}`)
          return obj.positive[0]
        },
      }
      break
    }
    case 'array':
      if (prop === 'length') return createNumber(obj.elements.length)
      if (prop === 'single') return {
        type: 'builtin', name: 'array.single',
        fn: () => {
          if (obj.elements.length !== 1)
            throw new Error(`single: expected array of length 1, got ${obj.elements.length}`)
          return obj.elements[0]
        },
      }
      if (prop === 'empty') return {
        type: 'builtin', name: 'array.empty',
        fn: () => {
          if (obj.elements.length !== 0)
            throw new Error(`empty: expected empty array, got length ${obj.elements.length}`)
          return createNull()
        },
      }
      break
    case 'scope': {
      const val = obj.bindings.get(prop)
      if (val !== undefined) return val
      break
    }
  }
  throw new Error(`No property '${prop}' on ${obj.type}`)
}


// Builtins


type Scope = Map<string, Value>

export function makeBuiltins(buf: DrawBuffer, g: LineageGraph): Scope {
  const scope: Scope = new Map()

  const register = (name: string, fn: (args: Value[]) => Value, ...aliases: string[]) => {
    const val: Value = { type: 'builtin', name, fn }
    scope.set(name, val)
    for (const a of aliases) scope.set(a, val)
  }

  const alias = (name: string, ...aliases: string[]) => {
    const val = scope.get(name);
    if (!val) return;
    for (const a of aliases) scope.set(a, val)
  }

  // Geometry constructors

  scope.set('pt', overloaded('pt', [
    signature([Num, Num], (x, y) => createPoint(x.value, y.value)),
  ]))

  scope.set('square', overloaded('square', [
    signature([Num, Num, Num], (x, y, s) =>
      constructRectangle(x.value, y.value, s.value, s.value, g)),
  ]))

  scope.set('rect', overloaded('rect', [
    signature([Num, Num, Num, Num], (x, y, w, h) =>
      constructRectangle(x.value, y.value, w.value, h.value, g)),
    signature([Pt2, Num, Num], (p, w, h) =>
      constructRectangle(p.x, p.y, w.value, h.value, g)),
    signature([Pt2, Pt2], (p1, p2) =>
      constructRectangle(
        p1.x.min(p2.x),
        p1.y.min(p2.y),
        p2.x.sub(p1.x).abs(),
        p2.y.sub(p1.y).abs(),
        g,
      )),
  ]))

  alias('rect', 'rectangle')

  scope.set('edge', overloaded('edge', [
    signature([Pt2, Pt2], (p1, p2) => createEdge(p1, p2, g)),
    signature([Num, Num, Num, Num], (x1, y1, x2, y2) =>
      createEdge(createPoint(x1.value, y1.value), createPoint(x2.value, y2.value), g)),
  ]))

  // Debug

  register('print', (args) => {
    console.log(args.map(showValue).join(' '))
    return createNull()
  })

  // Style builtins

  register('color', (args) => {
    if (args.length !== 1) throw new Error('color: expected 1 argument')
    return { type: 'style', fill: asString(args[0], 'color') } satisfies StyleVal
  })

  register('stroke', (args) => {
    if (args.length !== 1) throw new Error('stroke: expected 1 argument')
    return { type: 'style', stroke: asString(args[0], 'stroke') } satisfies StyleVal
  })

  scope.set('translucent', overloaded('translucent', [
    signature([Num], (n): StyleVal => ({ type: 'style', opacity: n.value.toNumber() })),
  ]))

  // Draw

  register('draw', (args) => {
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
    // Dashed style suppresses polygon fills
    if (batch.style.dashed) batch.polygons = []
    // color() applies to both fills and edges; stroke() is edges only
    if (batch.style.fill && !batch.style.stroke && batch.edges.length > 0) {
      batch.style.stroke = batch.style.fill
    }
    if (batch.points.length > 0 || batch.edges.length > 0 || batch.polygons.length > 0) {
      buf.batches.push(batch)
    }
    return createNull()
  })

  // Lineage query builtins

  register('from', (args) => ({ type: 'query', query: Query.from(args) }))
  register('fromAny', (args) => ({ type: 'query', query: Query.fromAny(args) }))
  register('derivedFrom', (args) => ({ type: 'query', query: Query.derivedFrom(args) }))
  register('derivedFromAny', (args) => ({ type: 'query', query: Query.derivedFromAny(args) }))

  register('contains', (args) => {
    if (args.length !== 1 || args[0].type !== 'query')
      throw new Error('contains: expected a query predicate')
    return { type: 'query', query: Query.contains(args[0].query) }
  })

  register('not', (args) => {
    if (args.length !== 1 || args[0].type !== 'query')
      throw new Error('not: expected a query predicate')
    return { type: 'query', query: Query.not(args[0].query) }
  })

  register('and', (args) => {
    if (args.length !== 2 || args[0].type !== 'query' || args[1].type !== 'query')
      throw new Error('and: expected two query predicates')
    return { type: 'query', query: Query.and(args[0].query, args[1].query) }
  })

  register('or', (args) => {
    if (args.length !== 2 || args[0].type !== 'query' || args[1].type !== 'query')
      throw new Error('or: expected two query predicates')
    return { type: 'query', query: Query.or(args[0].query, args[1].query) }
  })

  register('query', (args) => {
    const collection = args[0]
    const predicate = args[1]
    if (collection.type !== 'array')
      throw new Error('query: first argument must be an array')
    if (predicate.type !== 'query')
      throw new Error('query: second argument must be a query predicate')
    return { type: 'array', elements: Query.evaluateQuery(collection.elements, predicate.query, g) }
  })

  // Assertions

  register('single', (args) => {
    if (args.length !== 1 || args[0].type !== 'array')
      throw new Error('single: expected one array argument')
    const arr = args[0].elements
    if (arr.length !== 1)
      throw new Error(`single: expected array of length 1, got ${arr.length}`)
    return arr[0]
  })

  register('empty', (args) => {
    if (args.length !== 1 || args[0].type !== 'array')
      throw new Error('empty: expected one array argument')
    const arr = args[0].elements
    if (arr.length !== 0)
      throw new Error(`empty: expected empty array, got length ${arr.length}`)
    return createNull()
  })

  // Boolean operations

  const boolOp = (op: BooleanOp) =>
    overloaded(op, [
      signature([Rct, Rct], (a, b) => booleanOperation(a, b, op, g)),
      signature([Pgn, Pgn], (a, b) => booleanOperation(a, b, op, g)),
      signature([Rct, Pgn], (a, b) => booleanOperation(a, b, op, g)),
      signature([Pgn, Rct], (a, b) => booleanOperation(a, b, op, g)),
    ])

  scope.set('union', boolOp('union'))
  scope.set('difference', boolOp('difference'))
  scope.set('intersection', boolOp('intersection'))

  return scope
}
