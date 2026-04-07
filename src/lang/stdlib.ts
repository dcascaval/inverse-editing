import {
  type Value,
  type Point2Val,
  type Point3Val,
  type Edge3Val,
  type Polygon3Val,
  type PlanarFace3Val,
  type Face3Val,
  type ExtrusionVal,
  type PolygonVal,
  type RegionVal,
  type StyleVal,
  createNumber,
  createNull,
  createPoint,
  createPoint3,
  createEdge3,
  constructRectangle,
  createEdge,
  asNumber,
  asNumeric,
  asString,
  showValue,
} from '@/lang/values'
import type { NumericValue } from '@/lang/numeric'
import { real } from '@/lang/numeric'
import type { AnnotatedPoint2, AnnotatedEdge2 } from '@/lang/interpreter'
import { overloaded, signature, Num, Pt2, Rct, Pgn, Rgn, Ext } from '@/lang/overload'
import {
  transformValue,
  translationMatrix,
  rotateMatrix,
  rotateAroundMatrix,
  scaleMatrix,
  scaleAroundMatrix,
  mirrorMatrix,
  transformValue3D,
  translationMatrix3D,
  rotateXMatrix,
  rotateYMatrix,
  rotateZMatrix3D,
  scaleMatrix3D,
  rotateAxisMatrix3D,
} from '@/geometry/transform'
import type { LineageGraph } from '@/lang/lineage'
import * as Query from '@/lang/query'
import type { DrawBatch, DrawBuffer, Point3, Quad3, PlanarFaceDraw } from '@/lang/interpreter'
import { Matrix4, Vector3 } from 'three'
import { type BooleanOp, booleanOperation } from '@/geometry/boolean'
import { distributeHoles, pointInPolygon } from '@/geometry/polygon'


// Draw helpers

function pt2(p: { x: NumericValue; y: NumericValue }): AnnotatedPoint2 {
  return { x: p.x.toNumber(), y: p.y.toNumber(), sourceX: p.x, sourceY: p.y }
}

function edge2(e: { start: Point2Val; end: Point2Val }): AnnotatedEdge2 {
  return {
    start: pt2(e.start), end: pt2(e.end),
    sourceStart: e.start, sourceEnd: e.end,
  }
}

function pt3draw(p: Point3Val): AnnotatedPoint2 {
  return { x: p.x.toNumber(), y: p.y.toNumber(), z: p.z.toNumber(), sourceX: p.x, sourceY: p.y }
}

function edge3draw(e: Edge3Val): AnnotatedEdge2 {
  return {
    start: { x: e.start.x.toNumber(), y: e.start.y.toNumber(), z: e.start.z.toNumber() },
    end: { x: e.end.x.toNumber(), y: e.end.y.toNumber(), z: e.end.z.toNumber() },
  }
}

function p3(p: Point3Val): Point3 {
  return { x: p.x.toNumber(), y: p.y.toNumber(), z: p.z.toNumber() }
}

/** Build a Quad3 from a vertical Face3Val (bottom edge + extrusion vector). */
function verticalFaceToQuad(f: Face3Val): Quad3 {
  const s = p3(f.bottomEdge.start)
  const e = p3(f.bottomEdge.end)
  const { x: ex, y: ey, z: ez } = f.extrusion
  return [
    s, e,
    { x: e.x + ex, y: e.y + ey, z: e.z + ez },
    { x: s.x + ex, y: s.y + ey, z: s.z + ez },
  ]
}

/** Collect PlanarFaceDraws for an extrusion's top and bottom faces. */
function collectExtrusionPlanarFaces(ext: ExtrusionVal, batch: DrawBatch) {
  const polys2d = distributeHoles(ext.sourceRegion)
  const { extrusionVec: ev, placement } = ext
  const topMat = new Matrix4().makeTranslation(ev.x, ev.y, ev.z).multiply(placement)

  for (const poly of polys2d) {
    batch.planarFaces3.push({ polygon: poly, matrix: placement })
    batch.planarFaces3.push({ polygon: poly, matrix: topMat })
  }
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
    case 'point3':
      batch.points.push(pt3draw(v))
      break
    case 'edge3':
      batch.edges.push(edge3draw(v))
      break
    case 'polygon3':
      for (const e of v.edges) batch.edges.push(edge3draw(e))
      break
    case 'planarface3':
      for (const p of [...v.positive, ...v.negative])
        for (const e of p.edges) batch.edges.push(edge3draw(e))
      break
    case 'face3':
      batch.edges.push(edge3draw(v.bottomEdge))
      break
    case 'extrusion':
      for (const e of v.bottomEdges) batch.edges.push(edge3draw(e))
      for (const e of v.topEdges) batch.edges.push(edge3draw(e))
      for (const e of v.verticalEdges) batch.edges.push(edge3draw(e))
      // Solid face rendering
      for (const f of v.verticalFaces) batch.quads3.push(verticalFaceToQuad(f))
      collectExtrusionPlanarFaces(v, batch)
      break
    case 'array':
      for (const el of v.elements) collectDrawable(el, batch)
      break
  }
}


// Property access


function isGeometric(v: Value): boolean {
  return v.type === 'point2' || v.type === 'edge2' || v.type === 'rectangle'
    || v.type === 'polygon' || v.type === 'region'
    || v.type === 'point3' || v.type === 'edge3' || v.type === 'polygon3'
    || v.type === 'planarface3' || v.type === 'face3' || v.type === 'extrusion'
}

function is3D(v: Value): boolean {
  return v.type === 'point3' || v.type === 'edge3' || v.type === 'polygon3'
    || v.type === 'planarface3' || v.type === 'face3' || v.type === 'extrusion'
}

function makeTransformMethod(obj: Value, name: string, g: LineageGraph): Value {
  return {
    type: 'builtin',
    name: `${obj.type}.${name}`,
    fn: (args: Value[]) => {
      const threeD = is3D(obj)

      switch (name) {
        case 'translateX':
          if (threeD) return transformValue3D(translationMatrix3D(asNumber(args[0], 'translateX'), 0, 0), obj, g)
          return transformValue(translationMatrix(asNumber(args[0], 'translateX'), 0), obj, g)
        case 'translateY':
          if (threeD) return transformValue3D(translationMatrix3D(0, asNumber(args[0], 'translateY'), 0), obj, g)
          return transformValue(translationMatrix(0, asNumber(args[0], 'translateY')), obj, g)
        case 'translateZ': {
          if (!threeD) throw new Error('translateZ: only valid on 3D geometry')
          return transformValue3D(translationMatrix3D(0, 0, asNumber(args[0], 'translateZ')), obj, g)
        }
        case 'translate': {
          // Overload: translate(pt, z) → 3D translate by (pt.x, pt.y, z)
          if (args.length >= 2 && args[0].type === 'point2' && args[1].type === 'number') {
            const pt = args[0] as Point2Val
            const z = asNumber(args[1], 'translate z')
            if (threeD) return transformValue3D(translationMatrix3D(pt.x.toNumber(), pt.y.toNumber(), z), obj, g)
            return transformValue(translationMatrix(pt.x.toNumber(), pt.y.toNumber()), obj, g)
          }
          // Overload: translate(x, y)
          const tx = asNumber(args[0], 'translate x')
          const ty = asNumber(args[1], 'translate y')
          if (threeD) return transformValue3D(translationMatrix3D(tx, ty, 0), obj, g)
          return transformValue(translationMatrix(tx, ty), obj, g)
        }
        case 'rotate': {
          if (args.length >= 2 && args[0].type === 'point2') {
            if (threeD) throw new Error('rotate(center, deg): not supported on 3D geometry, use rotateAxis')
            return transformValue(rotateAroundMatrix(args[0], asNumber(args[1], 'rotate deg')), obj, g)
          }
          const deg = asNumber(args[0], 'rotate deg')
          if (threeD) return transformValue3D(rotateZMatrix3D(deg), obj, g)
          return transformValue(rotateMatrix(deg), obj, g)
        }
        case 'rotateX': {
          if (!threeD) throw new Error('rotateX: only valid on 3D geometry')
          return transformValue3D(rotateXMatrix(asNumber(args[0], 'rotateX deg')), obj, g)
        }
        case 'rotateY': {
          if (!threeD) throw new Error('rotateY: only valid on 3D geometry')
          return transformValue3D(rotateYMatrix(asNumber(args[0], 'rotateY deg')), obj, g)
        }
        case 'rotateAxis': {
          if (!threeD) throw new Error('rotateAxis: only valid on 3D geometry')
          if (args.length < 2 || args[0].type !== 'edge3')
            throw new Error('rotateAxis: expected (edge3, degrees)')
          const line = args[0] as Edge3Val
          const deg = asNumber(args[1], 'rotateAxis deg')
          const s = line.start, e = line.end
          return transformValue3D(
            rotateAxisMatrix3D(
              { x: s.x.toNumber(), y: s.y.toNumber(), z: s.z.toNumber() },
              { x: e.x.toNumber(), y: e.y.toNumber(), z: e.z.toNumber() },
              deg,
            ),
            obj, g,
          )
        }
        case 'scale': {
          if (args.length >= 2 && args[0].type === 'point2') {
            if (threeD) throw new Error('scale(center, f): not supported on 3D geometry')
            return transformValue(scaleAroundMatrix(args[0], asNumber(args[1], 'scale factor')), obj, g)
          }
          const f = asNumber(args[0], 'scale factor')
          if (threeD) return transformValue3D(scaleMatrix3D(f), obj, g)
          return transformValue(scaleMatrix(f), obj, g)
        }
        case 'mirror': {
          if (threeD) throw new Error('mirror: not yet supported on 3D geometry')
          if (args.length >= 2 && args[0].type === 'point2' && args[1].type === 'point2') {
            return transformValue(mirrorMatrix(args[0], args[1]), obj, g)
          }
          if (args.length >= 1 && args[0].type === 'edge2') {
            return transformValue(mirrorMatrix(args[0].start, args[0].end), obj, g)
          }
          throw new Error('mirror: expected (edge) or (point, point)')
        }
        case 'move': {
          if (args.length < 2 || args[0].type !== 'point2' || args[1].type !== 'point2')
            throw new Error('move: expected (point, point)')
          const a = args[0] as Point2Val, b = args[1] as Point2Val
          const dx = b.x.toNumber() - a.x.toNumber()
          const dy = b.y.toNumber() - a.y.toNumber()
          if (threeD) return transformValue3D(translationMatrix3D(dx, dy, 0), obj, g)
          return transformValue(translationMatrix(dx, dy), obj, g)
        }
        default:
          throw new Error(`Unknown transform method: ${name}`)
      }
    },
  }
}

const transformMethods = new Set([
  'translateX', 'translateY', 'translateZ', 'translate',
  'rotate', 'rotateX', 'rotateY', 'rotateAxis',
  'scale', 'mirror', 'move',
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
      if (prop === 'midpoint') {
        const mx = (obj.start.x.toNumber() + obj.end.x.toNumber()) / 2
        const my = (obj.start.y.toNumber() + obj.end.y.toNumber()) / 2
        const result = createPoint(mx, my)
        g.indirect([obj.start, obj.end], result)
        return result
      }
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
    case 'point3':
      if (prop === 'x') return createNumber(obj.x)
      if (prop === 'y') return createNumber(obj.y)
      if (prop === 'z') return createNumber(obj.z)
      break
    case 'edge3':
      if (prop === 'start') return obj.start
      if (prop === 'end') return obj.end
      if (prop === 'midpoint') {
        const mx = (obj.start.x.toNumber() + obj.end.x.toNumber()) / 2
        const my = (obj.start.y.toNumber() + obj.end.y.toNumber()) / 2
        const mz = (obj.start.z.toNumber() + obj.end.z.toNumber()) / 2
        const result = createPoint3(mx, my, mz)
        g.indirect([obj.start, obj.end], result)
        return result
      }
      break
    case 'polygon3':
      if (prop === 'points') return { type: 'array', elements: obj.points }
      if (prop === 'edges') return { type: 'array', elements: obj.edges }
      break
    case 'planarface3': {
      if (prop === 'positive') return { type: 'array', elements: obj.positive }
      if (prop === 'negative') return { type: 'array', elements: obj.negative }
      const allPolys = [...obj.positive, ...obj.negative]
      if (prop === 'points') return { type: 'array', elements: allPolys.flatMap((p) => p.points) }
      if (prop === 'edges') return { type: 'array', elements: allPolys.flatMap((p) => p.edges) }
      break
    }
    case 'face3':
      if (prop === 'bottomEdge') return obj.bottomEdge
      break
    case 'extrusion':
      if (prop === 'bottomEdges') return { type: 'array', elements: obj.bottomEdges }
      if (prop === 'topEdges') return { type: 'array', elements: obj.topEdges }
      if (prop === 'verticalEdges') return { type: 'array', elements: obj.verticalEdges }
      if (prop === 'verticalFaces') return { type: 'array', elements: obj.verticalFaces }
      if (prop === 'bottomFace') return obj.bottomFace
      if (prop === 'topFace') return obj.topFace
      if (prop === 'edges') return { type: 'array', elements: [...obj.bottomEdges, ...obj.topEdges, ...obj.verticalEdges] }
      if (prop === 'points') {
        const seen = new Set<Value>()
        const pts: Value[] = []
        for (const e of [...obj.bottomEdges, ...obj.topEdges, ...obj.verticalEdges]) {
          if (!seen.has(e.start)) { seen.add(e.start); pts.push(e.start) }
          if (!seen.has(e.end)) { seen.add(e.end); pts.push(e.end) }
        }
        return { type: 'array', elements: pts }
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
    const batch: DrawBatch = { points: [], edges: [], polygons: [], quads3: [], planarFaces3: [], style: {} }
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
    if (batch.points.length > 0 || batch.edges.length > 0 || batch.polygons.length > 0
      || batch.quads3.length > 0 || batch.planarFaces3.length > 0) {
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

  // 3D: Extrude3D

  register('Extrude3D', (args) => {
    if (args.length !== 2) throw new Error('Extrude3D: expected (region/polygon, height)')
    const heightNV = asNumeric(args[1], 'Extrude3D height')
    let region: RegionVal
    if (args[0].type === 'region') {
      region = args[0]
    } else if (args[0].type === 'polygon') {
      region = { type: 'region', positive: [args[0]], negative: [] }
    } else if (args[0].type === 'rectangle') {
      const poly: PolygonVal = { type: 'polygon', points: args[0].points, edges: args[0].edges }
      region = { type: 'region', positive: [poly], negative: [] }
    } else {
      throw new Error('Extrude3D: first argument must be a region, polygon, or rectangle')
    }
    return createExtrusionVal(region, heightNV, g)
  })

  // 3D: Axis constants

  const origin3 = createPoint3(0, 0, 0)
  scope.set('Axis', {
    type: 'scope',
    bindings: new Map<string, Value>([
      ['X', { type: 'edge3', start: origin3, end: createPoint3(1, 0, 0) } as Edge3Val],
      ['Y', { type: 'edge3', start: origin3, end: createPoint3(0, 1, 0) } as Edge3Val],
      ['Z', { type: 'edge3', start: origin3, end: createPoint3(0, 0, 1) } as Edge3Val],
    ]),
  })

  return scope
}


// ── Extrusion construction ──


function extrudePolygon(
  poly: PolygonVal, h: number, g: LineageGraph,
  bottomEdges: Edge3Val[], topEdges: Edge3Val[],
  verticalEdges: Edge3Val[], verticalFaces: Face3Val[],
): { bottom: Polygon3Val; top: Polygon3Val } {
  const n = poly.points.length
  const bottomPts: Point3Val[] = []
  const topPts: Point3Val[] = []

  // Create bottom (z=0) and top (z=h) 3D points with lineage from 2D points
  for (const pt of poly.points) {
    const bp = createPoint3(pt.x.toNumber(), pt.y.toNumber(), 0)
    g.direct(pt, bp)
    bottomPts.push(bp)

    const tp = createPoint3(pt.x.toNumber(), pt.y.toNumber(), h)
    g.direct(pt, tp)
    topPts.push(tp)

    // Vertical edge: lineage from the 2D point being "extruded"
    const ve = createEdge3(bp, tp, g)
    g.direct(pt, ve)
    verticalEdges.push(ve)
  }

  const polyBottomEdges: Edge3Val[] = []
  const polyTopEdges: Edge3Val[] = []

  // Create bottom and top edges with lineage from 2D edges
  for (let i = 0; i < poly.edges.length; i++) {
    const e2 = poly.edges[i]

    const be = createEdge3(bottomPts[i], bottomPts[(i + 1) % n], g)
    g.direct(e2, be)
    bottomEdges.push(be)
    polyBottomEdges.push(be)

    const te = createEdge3(topPts[i], topPts[(i + 1) % n], g)
    g.direct(e2, te)
    topEdges.push(te)
    polyTopEdges.push(te)

    // Vertical face: analytical representation, lineage from region edge
    const face: Face3Val = {
      type: 'face3',
      bottomEdge: be,
      extrusion: new Vector3(0, 0, h),
    }
    g.direct(e2, face)
    g.indirect(be, face)
    verticalFaces.push(face)
  }

  // Build per-polygon 3D polygons (for top/bottom faces)
  const bottomPoly: Polygon3Val = { type: 'polygon3', points: bottomPts, edges: polyBottomEdges }
  g.direct(poly, bottomPoly)
  const topPoly: Polygon3Val = { type: 'polygon3', points: topPts, edges: polyTopEdges }
  g.direct(poly, topPoly)

  return { bottom: bottomPoly, top: topPoly }
}

function createExtrusionVal(region: RegionVal, height: NumericValue, g: LineageGraph): ExtrusionVal {
  const h = height.toNumber()

  const bottomEdges: Edge3Val[] = []
  const topEdges: Edge3Val[] = []
  const verticalEdges: Edge3Val[] = []
  const verticalFaces: Face3Val[] = []

  const bottomPositive: Polygon3Val[] = []
  const bottomNegative: Polygon3Val[] = []
  const topPositive: Polygon3Val[] = []
  const topNegative: Polygon3Val[] = []

  for (const poly of region.positive) {
    const { bottom, top } = extrudePolygon(poly, h, g, bottomEdges, topEdges, verticalEdges, verticalFaces)
    bottomPositive.push(bottom)
    topPositive.push(top)
  }
  for (const poly of region.negative) {
    const { bottom, top } = extrudePolygon(poly, h, g, bottomEdges, topEdges, verticalEdges, verticalFaces)
    bottomNegative.push(bottom)
    topNegative.push(top)
  }

  // Build planar faces with lineage from region
  const bottomFace: PlanarFace3Val = { type: 'planarface3', positive: bottomPositive, negative: bottomNegative }
  g.direct(region, bottomFace)
  const topFace: PlanarFace3Val = { type: 'planarface3', positive: topPositive, negative: topNegative }
  g.direct(region, topFace)

  const result: ExtrusionVal = {
    type: 'extrusion',
    sourceRegion: region,
    extrusionVec: new Vector3(0, 0, h),
    placement: new Matrix4(),
    bottomEdges, topEdges, verticalEdges, verticalFaces,
    bottomFace, topFace,
  }

  // Direct lineage from region and its polygons to the extrusion
  g.direct(region, result)
  for (const poly of [...region.positive, ...region.negative]) {
    g.direct(poly, result)
  }

  return result
}
