import { Matrix4, Vector3, Vector4 } from 'three'
import type { NumericValue } from '@/lang/numeric'
import type { Tape } from '@/lang/grad'
import {
  type Value,
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
  nv,
} from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'


// 2D Affine Transform
// 
// Represents: x' = a*x + c*y + tx
//             y' = b*x + d*y + ty


export type Affine2D = {
  a: NumericValue; b: NumericValue
  c: NumericValue; d: NumericValue
  tx: NumericValue; ty: NumericValue
}

function affine(
  a: number, b: number, c: number, d: number,
  tx: NumericValue, ty: NumericValue, tape?: Tape | null,
): Affine2D {
  return {
    a: nv(a, tape), b: nv(b, tape),
    c: nv(c, tape), d: nv(d, tape),
    tx, ty,
  }
}

/** Compose two affine transforms: result = outer ∘ inner */
function compose(outer: Affine2D, inner: Affine2D): Affine2D {
  return {
    a: outer.a.mul(inner.a).add(outer.c.mul(inner.b)),
    b: outer.b.mul(inner.a).add(outer.d.mul(inner.b)),
    c: outer.a.mul(inner.c).add(outer.c.mul(inner.d)),
    d: outer.b.mul(inner.c).add(outer.d.mul(inner.d)),
    tx: outer.a.mul(inner.tx).add(outer.c.mul(inner.ty)).add(outer.tx),
    ty: outer.b.mul(inner.tx).add(outer.d.mul(inner.ty)).add(outer.ty),
  }
}

function applyToPoint(m: Affine2D, p: Point2Val): Point2Val {
  return createPoint(
    m.a.mul(p.x).add(m.c.mul(p.y)).add(m.tx),
    m.b.mul(p.x).add(m.d.mul(p.y)).add(m.ty),
  )
}


// Matrix constructors


export function translationMatrix(tx: NumericValue, ty: NumericValue, tape?: Tape | null): Affine2D {
  const zero = nv(0, tape)
  return affine(1, 0, 0, 1, tx, ty, tape)
}

export function rotateMatrix(degrees: NumericValue, tape?: Tape | null): Affine2D {
  const r = degrees.mul(nv(Math.PI / 180, tape))
  const c = r.cos(), s = r.sin()
  const zero = nv(0, tape)
  return { a: c, b: s, c: s.neg(), d: c, tx: zero, ty: zero }
}

export function scaleMatrix(f: NumericValue, tape?: Tape | null): Affine2D {
  const zero = nv(0, tape)
  return { a: f, b: zero, c: zero, d: f, tx: zero, ty: zero }
}

function aroundCenter(center: Point2Val, inner: Affine2D, tape?: Tape | null): Affine2D {
  const pre = translationMatrix(center.x.neg(), center.y.neg(), tape)
  const post = translationMatrix(center.x, center.y, tape)
  return compose(post, compose(inner, pre))
}

export function rotateAroundMatrix(center: Point2Val, degrees: NumericValue, tape?: Tape | null): Affine2D {
  return aroundCenter(center, rotateMatrix(degrees, tape), tape)
}

export function scaleAroundMatrix(center: Point2Val, f: NumericValue, tape?: Tape | null): Affine2D {
  return aroundCenter(center, scaleMatrix(f, tape), tape)
}

export function mirrorMatrix(p1: Point2Val, p2: Point2Val, tape?: Tape | null): Affine2D {
  const dx = p2.x.sub(p1.x)
  const dy = p2.y.sub(p1.y)
  const len2 = dx.mul(dx).add(dy.mul(dy))
  if (len2.toNumber() === 0) throw new Error('mirror: two distinct points required')
  // cos(2θ) = (dx²-dy²)/len², sin(2θ) = 2·dx·dy/len²
  const cos2 = dx.mul(dx).sub(dy.mul(dy)).div(len2)
  const sin2 = dx.mul(dy).mul(nv(2, tape)).div(len2)
  const zero = nv(0, tape)
  const inner: Affine2D = { a: cos2, b: sin2, c: sin2, d: cos2.neg(), tx: zero, ty: zero }
  return aroundCenter(p1, inner, tape)
}


// Transform geometric values (non-mutating, with lineage tracking)


function transformPt(m: Affine2D, p: Point2Val, g: LineageGraph): Point2Val {
  const result = applyToPoint(m, p)
  g.direct(p, result)
  return result
}

function transformEdge(m: Affine2D, e: Edge2Val, g: LineageGraph): Edge2Val {
  const start = transformPt(m, e.start, g)
  const end = transformPt(m, e.end, g)
  const result = createEdge(start, end, g)
  g.direct(e, result)
  return result
}

function transformRectangle(m: Affine2D, r: RectangleVal, g: LineageGraph): RectangleVal {
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

function transformPolygon(m: Affine2D, p: PolygonVal, g: LineageGraph): PolygonVal {
  const pts = p.points.map((pt) => transformPt(m, pt, g))
  const result = createPolygon(pts, g)
  for (let i = 0; i < p.edges.length; i++) {
    g.direct(p.edges[i], result.edges[i])
  }
  g.direct(p, result)
  return result
}

function transformRegion(m: Affine2D, r: RegionVal, g: LineageGraph): RegionVal {
  const positive = r.positive.map((p) => transformPolygon(m, p, g))
  const negative = r.negative.map((p) => transformPolygon(m, p, g))
  const result: RegionVal = { type: 'region', positive, negative }
  g.direct(r, result)
  return result
}

export function transformValue(m: Affine2D, v: Value, g: LineageGraph): Value {
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
// 3D transforms still use Matrix4 since they involve trig/rotation that
// we don't yet track on the tape. The output points are lifted to NumericValue.


export type { Matrix4 }

export function translationMatrix3D(tx: NumericValue, ty: NumericValue, tz: NumericValue, tape?: Tape | null): Matrix4 {
  return new Matrix4().makeTranslation(tx.toNumber(), ty.toNumber(), tz.toNumber())
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
  origin: Point3Val,
  dir: Point3Val,
  degrees: number,
): Matrix4 {
  const ox = origin.x.toNumber(), oy = origin.y.toNumber(), oz = origin.z.toNumber()
  const axis = new Vector3(
    dir.x.toNumber() - ox, dir.y.toNumber() - oy, dir.z.toNumber() - oz,
  ).normalize()
  const rot = new Matrix4().makeRotationAxis(axis, degrees * Math.PI / 180)
  if (ox === 0 && oy === 0 && oz === 0) return rot
  const pre = new Matrix4().makeTranslation(-ox, -oy, -oz)
  const post = new Matrix4().makeTranslation(ox, oy, oz)
  return post.multiply(rot).multiply(pre)
}


// ── 3D Transform application ──
// These still use toNumber() for Matrix4 multiplication, then lift back.
// TODO: convert 3D transforms to NumericValue arithmetic when trig ops are on tape.


const _v4 = new Vector4()

function applyToPoint3D(m: Matrix4, p: Point3Val, tape?: Tape | null): Point3Val {
  _v4.set(p.x.toNumber(), p.y.toNumber(), p.z.toNumber(), 1).applyMatrix4(m)
  return createPoint3(nv(_v4.x, tape), nv(_v4.y, tape), nv(_v4.z, tape))
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

function transformPt3(m: Matrix4, p: Point3Val, g: LineageGraph, tape?: Tape | null): Point3Val {
  const result = applyToPoint3D(m, p, tape)
  g.direct(p, result)
  return result
}

function transformEdge3D(m: Matrix4, e: Edge3Val, g: LineageGraph, tape?: Tape | null): Edge3Val {
  const start = transformPt3(m, e.start, g, tape)
  const end = transformPt3(m, e.end, g, tape)
  const result = createEdge3(start, end, g)
  g.direct(e, result)
  return result
}

function transformPolygon3D(m: Matrix4, p: Polygon3Val, g: LineageGraph, tape?: Tape | null): Polygon3Val {
  const pts = p.points.map((pt) => transformPt3(m, pt, g, tape))
  const edges = p.edges.map((e) => transformEdge3D(m, e, g, tape))
  for (let i = 0; i < p.edges.length; i++) g.direct(p.edges[i], edges[i])
  const result: Polygon3Val = { type: 'polygon3', points: pts, edges }
  g.direct(p, result)
  return result
}

function transformPlanarFace3D(m: Matrix4, f: PlanarFace3Val, g: LineageGraph, tape?: Tape | null): PlanarFace3Val {
  const positive = f.positive.map((p) => transformPolygon3D(m, p, g, tape))
  const negative = f.negative.map((p) => transformPolygon3D(m, p, g, tape))
  const result: PlanarFace3Val = { type: 'planarface3', positive, negative }
  g.direct(f, result)
  return result
}

function transformFace3D(m: Matrix4, f: Face3Val, g: LineageGraph, tape?: Tape | null): Face3Val {
  const bottomEdge = transformEdge3D(m, f.bottomEdge, g, tape)
  const extrusion = rotateVector3D(m, f.extrusion)
  const result: Face3Val = { type: 'face3', bottomEdge, extrusion }
  g.direct(f, result)
  return result
}

function transformExtrusion(m: Matrix4, ext: ExtrusionVal, g: LineageGraph, tape?: Tape | null): ExtrusionVal {
  const bottomEdges = ext.bottomEdges.map((e) => transformEdge3D(m, e, g, tape))
  const topEdges = ext.topEdges.map((e) => transformEdge3D(m, e, g, tape))
  const verticalEdges = ext.verticalEdges.map((e) => transformEdge3D(m, e, g, tape))
  const verticalFaces = ext.verticalFaces.map((f) => transformFace3D(m, f, g, tape))
  const bottomFace = transformPlanarFace3D(m, ext.bottomFace, g, tape)
  const topFace = transformPlanarFace3D(m, ext.topFace, g, tape)
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

export function transformValue3D(m: Matrix4, v: Value, g: LineageGraph, tape?: Tape | null): Value {
  switch (v.type) {
    case 'point3': return transformPt3(m, v, g, tape)
    case 'edge3': return transformEdge3D(m, v, g, tape)
    case 'polygon3': return transformPolygon3D(m, v, g, tape)
    case 'planarface3': return transformPlanarFace3D(m, v, g, tape)
    case 'face3': return transformFace3D(m, v, g, tape)
    case 'extrusion': return transformExtrusion(m, v, g, tape)
    default: throw new Error(`Cannot 3D-transform ${v.type}`)
  }
}
