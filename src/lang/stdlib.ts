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
import type { LineageGraph } from '@/lang/lineage'
import * as Query from '@/lang/query'
import type { DrawBatch, DrawBuffer } from '@/lang/interpreter'


// Draw helpers

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
    case 'array':
      for (const el of v.elements) collectDrawable(el, batch)
      break
  }
}


// Property access


function isGeometric(v: Value): boolean {
  return v.type === 'point2' || v.type === 'edge2' || v.type === 'rectangle'
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
        case 'rotateX': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(rotateXAroundMatrix(args[0], asNumber(args[1], 'rotateX deg')), obj, g)
          }
          return transformValue(rotateXMatrix(asNumber(args[0], 'rotateX deg')), obj, g)
        }
        case 'rotateY': {
          if (args.length >= 2 && args[0].type === 'point2') {
            return transformValue(rotateYAroundMatrix(args[0], asNumber(args[1], 'rotateY deg')), obj, g)
          }
          return transformValue(rotateYMatrix(asNumber(args[0], 'rotateY deg')), obj, g)
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
  'rotateX', 'rotateY',
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
      if (prop === 'start') return createPoint(obj.start.x, obj.start.y)
      if (prop === 'end') return createPoint(obj.end.x, obj.end.y)
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


// Builtins


type Scope = Map<string, Value>

export function makeBuiltins(buf: DrawBuffer, g: LineageGraph): Scope {
  const scope: Scope = new Map()

  scope.set('pt', overloaded('pt', [
    sig([Num, Num], (x, y) => createPoint(x.value, y.value)),
  ]))

  scope.set('rect', overloaded('rect', [
    sig([Num, Num, Num, Num], (x, y, w, h) =>
      constructRectangle(x.value, y.value, w.value, h.value, g)),
    sig([Pt2, Pt2], (p1, p2) =>
      constructRectangle(
        Math.min(p1.x, p2.x),
        Math.min(p1.y, p2.y),
        Math.abs(p2.x - p1.x),
        Math.abs(p2.y - p1.y),
        g,
      )),
  ]))

  scope.set('edge', overloaded('edge', [
    sig([Pt2, Pt2], (p1, p2) => createEdge(p1, p2, g)),
    sig([Num, Num, Num, Num], (x1, y1, x2, y2) =>
      createEdge(createPoint(x1.value, y1.value), createPoint(x2.value, y2.value), g)),
  ]))

  // Style builtins
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
      return createNull()
    },
  })

  // Lineage query builtins

  scope.set('from', {
    type: 'builtin',
    name: 'from',
    fn: (args: Value[]): Value => ({ type: 'query', query: Query.from(args) }),
  })

  scope.set('fromAny', {
    type: 'builtin',
    name: 'fromAny',
    fn: (args: Value[]): Value => ({ type: 'query', query: Query.fromAny(args) }),
  })

  scope.set('derivedFrom', {
    type: 'builtin',
    name: 'derivedFrom',
    fn: (args: Value[]): Value => ({ type: 'query', query: Query.derivedFrom(args) }),
  })

  scope.set('derivedFromAny', {
    type: 'builtin',
    name: 'derivedFromAny',
    fn: (args: Value[]): Value => ({ type: 'query', query: Query.derivedFromAny(args) }),
  })

  scope.set('contains', {
    type: 'builtin',
    name: 'contains',
    fn: (args: Value[]): Value => {
      if (args.length !== 1 || args[0].type !== 'query')
        throw new Error('contains: expected a query predicate')
      return { type: 'query', query: Query.contains(args[0].query) }
    },
  })

  scope.set('not', {
    type: 'builtin',
    name: 'not',
    fn: (args: Value[]): Value => {
      if (args.length !== 1 || args[0].type !== 'query')
        throw new Error('not: expected a query predicate')
      return { type: 'query', query: Query.not(args[0].query) }
    },
  })

  scope.set('and', {
    type: 'builtin',
    name: 'and',
    fn: (args: Value[]): Value => {
      if (args.length !== 2 || args[0].type !== 'query' || args[1].type !== 'query')
        throw new Error('and: expected two query predicates')
      return { type: 'query', query: Query.and(args[0].query, args[1].query) }
    },
  })

  scope.set('or', {
    type: 'builtin',
    name: 'or',
    fn: (args: Value[]): Value => {
      if (args.length !== 2 || args[0].type !== 'query' || args[1].type !== 'query')
        throw new Error('or: expected two query predicates')
      return { type: 'query', query: Query.or(args[0].query, args[1].query) }
    },
  })

  scope.set('query', {
    type: 'builtin',
    name: 'query',
    fn: (args: Value[]): Value => {
      const collection = args[0]
      const predicate = args[1]
      if (collection.type !== 'array')
        throw new Error('query: first argument must be an array')
      if (predicate.type !== 'query')
        throw new Error('query: second argument must be a query predicate')
      const filtered = Query.evaluateQuery(collection.elements, predicate.query, g)
      return { type: 'array', elements: filtered }
    },
  })

  return scope
}
