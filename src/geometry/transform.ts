import { Matrix3, Matrix4, Vector3, Vector4 } from 'three'
import {
  type Value,
  type Point2,
  type Point2Val,
  type Edge2Val,
  type RectangleVal,
  type PolygonVal,
  type RegionVal,
  type Point3Val,
  type Edge3Val,
  type Polygon3Val,
  type PlanarFace3Val,
  type Face3Val,
  type ExtrusionVal,
  createPoint,
  createEdge,
  createRectangle,
  createPolygon,
  createPoint3,
  createEdge3,
} from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'


// We use three's Matrix3 for 2D affine transforms.
// Column-major elements layout:
//   [a, b, 0, c, d, 0, tx, ty, 1]

export type { Matrix3 }

function mat(a: number, b: number, c: number, d: number, tx: number, ty: number): Matrix3 {
  const m = new Matrix3()
  m.set(a, c, tx, b, d, ty, 0, 0, 1)
  return m
}

const _v = new Vector3()

function applyToPoint(m: Matrix3, p: Point2Val): Point2 {
  _v.set(p.x.toNumber(), p.y.toNumber(), 1).applyMatrix3(m)
  return { x: _v.x, y: _v.y }
}


// Matrix constructors


export function translationMatrix(tx: number, ty: number): Matrix3 {
  return mat(1, 0, 0, 1, tx, ty)
}

/** Standard 2D rotation (around Z axis) by the given angle in degrees. */
export function rotateMatrix(degrees: number): Matrix3 {
  const r = degrees * Math.PI / 180
  const c = Math.cos(r), s = Math.sin(r)
  return mat(c, s, -s, c, 0, 0)
}

export function scaleMatrix(f: number): Matrix3 {
  return mat(f, 0, 0, f, 0, 0)
}

function aroundCenter(center: Point2Val, inner: Matrix3): Matrix3 {
  const cx = center.x.toNumber(), cy = center.y.toNumber()
  const pre = translationMatrix(-cx, -cy)
  const post = translationMatrix(cx, cy)
  return post.multiply(inner).multiply(pre)
}

export function rotateAroundMatrix(center: Point2Val, degrees: number): Matrix3 {
  return aroundCenter(center, rotateMatrix(degrees))
}

export function scaleAroundMatrix(center: Point2Val, f: number): Matrix3 {
  return aroundCenter(center, scaleMatrix(f))
}

export function mirrorMatrix(p1: Point2Val, p2: Point2Val): Matrix3 {
  const dx = p2.x.toNumber() - p1.x.toNumber()
  const dy = p2.y.toNumber() - p1.y.toNumber()
  const len2 = dx * dx + dy * dy
  if (len2 === 0) throw new Error('mirror: two distinct points required')
  const cos2 = (dx * dx - dy * dy) / len2
  const sin2 = 2 * dx * dy / len2
  return aroundCenter(p1, mat(cos2, sin2, sin2, -cos2, 0, 0))
}


// Transform geometric values (non-mutating, with optional lineage tracking)


function transformPt(m: Matrix3, p: Point2Val, g: LineageGraph): Point2Val {
  const tp = applyToPoint(m, p)
  const result = createPoint(tp.x, tp.y)
  g.direct(p, result)
  return result
}

function transformEdge(m: Matrix3, e: Edge2Val, g: LineageGraph): Edge2Val {
  const start = transformPt(m, e.start, g)
  const end = transformPt(m, e.end, g)
  const result = createEdge(start, end, g)
  g.direct(e, result)
  return result
}

function transformRectangle(m: Matrix3, r: RectangleVal, g: LineageGraph): RectangleVal {
  const bl = transformPt(m, r.bottomLeft, g)
  const br = transformPt(m, r.bottomRight, g)
  const tl = transformPt(m, r.topLeft, g)
  const tr = transformPt(m, r.topRight, g)
  const result = createRectangle(bl, br, tl, tr, g)
  for (let i = 0; i < r.edges.length; i++) {
    g.direct(r.edges[i], result.edges[i])
  }
  g.direct(r, result)
  return result
}

function transformPolygon(m: Matrix3, p: PolygonVal, g: LineageGraph): PolygonVal {
  const pts = p.points.map((pt) => transformPt(m, pt, g))
  const result = createPolygon(pts, g)
  for (let i = 0; i < p.edges.length; i++) {
    g.direct(p.edges[i], result.edges[i])
  }
  g.direct(p, result)
  return result
}

function transformRegion(m: Matrix3, r: RegionVal, g: LineageGraph): RegionVal {
  const positive = r.positive.map((p) => transformPolygon(m, p, g))
  const negative = r.negative.map((p) => transformPolygon(m, p, g))
  const result: RegionVal = { type: 'region', positive, negative }
  g.direct(r, result)
  return result
}

export function transformValue(m: Matrix3, v: Value, g: LineageGraph): Value {
  switch (v.type) {
    case 'point2': return transformPt(m, v, g)
    case 'edge2': return transformEdge(m, v, g)
    case 'rectangle': return transformRectangle(m, v, g)
    case 'polygon': return transformPolygon(m, v, g)
    case 'region': return transformRegion(m, v, g)
    default: throw new Error(`Cannot transform ${v.type}`)
  }
}


// ── 3D Transform Matrices (Matrix4) ──


export type { Matrix4 }

export function translationMatrix3D(tx: number, ty: number, tz: number): Matrix4 {
  return new Matrix4().makeTranslation(tx, ty, tz)
}

export function rotateXMatrix(degrees: number): Matrix4 {
  return new Matrix4().makeRotationX(degrees * Math.PI / 180)
}

export function rotateYMatrix(degrees: number): Matrix4 {
  return new Matrix4().makeRotationY(degrees * Math.PI / 180)
}

export function rotateZMatrix3D(degrees: number): Matrix4 {
  return new Matrix4().makeRotationZ(degrees * Math.PI / 180)
}

export function scaleMatrix3D(f: number): Matrix4 {
  return new Matrix4().makeScale(f, f, f)
}

export function rotateAxisMatrix3D(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  degrees: number,
): Matrix4 {
  const axis = new Vector3(dir.x - origin.x, dir.y - origin.y, dir.z - origin.z).normalize()
  const rot = new Matrix4().makeRotationAxis(axis, degrees * Math.PI / 180)
  if (origin.x === 0 && origin.y === 0 && origin.z === 0) return rot
  const pre = new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z)
  const post = new Matrix4().makeTranslation(origin.x, origin.y, origin.z)
  return post.multiply(rot).multiply(pre)
}


// ── 3D Transform application ──


const _v4 = new Vector4()

function applyToPoint3D(m: Matrix4, p: Point3Val): { x: number; y: number; z: number } {
  _v4.set(p.x.toNumber(), p.y.toNumber(), p.z.toNumber(), 1).applyMatrix4(m)
  return { x: _v4.x, y: _v4.y, z: _v4.z }
}

/** Apply only the rotational part of a Matrix4 (upper-left 3×3) to a vector. */
function rotateVector3D(m: Matrix4, v: Vector3): Vector3 {
  const e = m.elements // column-major
  return new Vector3(
    e[0] * v.x + e[4] * v.y + e[8] * v.z,
    e[1] * v.x + e[5] * v.y + e[9] * v.z,
    e[2] * v.x + e[6] * v.y + e[10] * v.z,
  )
}

function transformPt3(m: Matrix4, p: Point3Val, g: LineageGraph): Point3Val {
  const tp = applyToPoint3D(m, p)
  const result = createPoint3(tp.x, tp.y, tp.z)
  g.direct(p, result)
  return result
}

function transformEdge3D(m: Matrix4, e: Edge3Val, g: LineageGraph): Edge3Val {
  const start = transformPt3(m, e.start, g)
  const end = transformPt3(m, e.end, g)
  const result = createEdge3(start, end, g)
  g.direct(e, result)
  return result
}

function transformPolygon3D(m: Matrix4, p: Polygon3Val, g: LineageGraph): Polygon3Val {
  const pts = p.points.map((pt) => transformPt3(m, pt, g))
  const edges = p.edges.map((e) => transformEdge3D(m, e, g))
  for (let i = 0; i < p.edges.length; i++) g.direct(p.edges[i], edges[i])
  const result: Polygon3Val = { type: 'polygon3', points: pts, edges }
  g.direct(p, result)
  return result
}

function transformPlanarFace3D(m: Matrix4, f: PlanarFace3Val, g: LineageGraph): PlanarFace3Val {
  const positive = f.positive.map((p) => transformPolygon3D(m, p, g))
  const negative = f.negative.map((p) => transformPolygon3D(m, p, g))
  const result: PlanarFace3Val = { type: 'planarface3', positive, negative }
  g.direct(f, result)
  return result
}

function transformFace3D(m: Matrix4, f: Face3Val, g: LineageGraph): Face3Val {
  const bottomEdge = transformEdge3D(m, f.bottomEdge, g)
  const extrusion = rotateVector3D(m, f.extrusion)
  const result: Face3Val = { type: 'face3', bottomEdge, extrusion }
  g.direct(f, result)
  return result
}

function transformExtrusion(m: Matrix4, ext: ExtrusionVal, g: LineageGraph): ExtrusionVal {
  const bottomEdges = ext.bottomEdges.map((e) => transformEdge3D(m, e, g))
  const topEdges = ext.topEdges.map((e) => transformEdge3D(m, e, g))
  const verticalEdges = ext.verticalEdges.map((e) => transformEdge3D(m, e, g))
  const verticalFaces = ext.verticalFaces.map((f) => transformFace3D(m, f, g))
  const bottomFace = transformPlanarFace3D(m, ext.bottomFace, g)
  const topFace = transformPlanarFace3D(m, ext.topFace, g)
  const result: ExtrusionVal = {
    type: 'extrusion',
    sourceRegion: ext.sourceRegion,
    extrusionVec: rotateVector3D(m, ext.extrusionVec),
    placement: new Matrix4().copy(m).multiply(ext.placement),
    bottomEdges, topEdges, verticalEdges, verticalFaces,
    bottomFace, topFace,
  }
  g.direct(ext, result)
  return result
}

export function transformValue3D(m: Matrix4, v: Value, g: LineageGraph): Value {
  switch (v.type) {
    case 'point3': return transformPt3(m, v, g)
    case 'edge3': return transformEdge3D(m, v, g)
    case 'polygon3': return transformPolygon3D(m, v, g)
    case 'planarface3': return transformPlanarFace3D(m, v, g)
    case 'face3': return transformFace3D(m, v, g)
    case 'extrusion': return transformExtrusion(m, v, g)
    default: throw new Error(`Cannot 3D-transform ${v.type}`)
  }
}
