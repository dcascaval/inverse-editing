import { Matrix3, Vector3 } from 'three'
import {
  type Value,
  type Point2,
  type Point2Val,
  type Edge2Val,
  type RectangleVal,
  createPoint,
  createEdge,
  createRectangle,
} from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'

// ---------------------------------------------------------------------------
// We use three's Matrix3 for 2D affine transforms.
// Column-major elements layout:
//   [a, b, 0, c, d, 0, tx, ty, 1]
// ---------------------------------------------------------------------------

export type { Matrix3 }

function mat(a: number, b: number, c: number, d: number, tx: number, ty: number): Matrix3 {
  const m = new Matrix3()
  m.set(a, c, tx, b, d, ty, 0, 0, 1)
  return m
}

const _v = new Vector3()

function applyToPoint(m: Matrix3, p: Point2): Point2 {
  _v.set(p.x, p.y, 1).applyMatrix3(m)
  return { x: _v.x, y: _v.y }
}

// ---------------------------------------------------------------------------
// Matrix constructors
// ---------------------------------------------------------------------------

export function translationMatrix(tx: number, ty: number): Matrix3 {
  return mat(1, 0, 0, 1, tx, ty)
}

/** Rotate around X axis projected to 2D — scales Y by cos(θ) */
export function rotateXMatrix(degrees: number): Matrix3 {
  const c = Math.cos(degrees * Math.PI / 180)
  return mat(1, 0, 0, c, 0, 0)
}

/** Rotate around Y axis projected to 2D — scales X by cos(θ) */
export function rotateYMatrix(degrees: number): Matrix3 {
  const c = Math.cos(degrees * Math.PI / 180)
  return mat(c, 0, 0, 1, 0, 0)
}

export function scaleMatrix(f: number): Matrix3 {
  return mat(f, 0, 0, f, 0, 0)
}

function aroundCenter(center: Point2, inner: Matrix3): Matrix3 {
  const pre = translationMatrix(-center.x, -center.y)
  const post = translationMatrix(center.x, center.y)
  return post.multiply(inner).multiply(pre)
}

export function rotateXAroundMatrix(center: Point2, degrees: number): Matrix3 {
  return aroundCenter(center, rotateXMatrix(degrees))
}

export function rotateYAroundMatrix(center: Point2, degrees: number): Matrix3 {
  return aroundCenter(center, rotateYMatrix(degrees))
}

export function scaleAroundMatrix(center: Point2, f: number): Matrix3 {
  return aroundCenter(center, scaleMatrix(f))
}

export function mirrorMatrix(p1: Point2, p2: Point2): Matrix3 {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) throw new Error('mirror: two distinct points required')
  const cos2 = (dx * dx - dy * dy) / len2
  const sin2 = 2 * dx * dy / len2
  return aroundCenter(p1, mat(cos2, sin2, sin2, -cos2, 0, 0))
}

// ---------------------------------------------------------------------------
// Transform geometric values (non-mutating, with optional lineage tracking)
// ---------------------------------------------------------------------------

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
  g.direct(r.bottom, result.bottom)
  g.direct(r.right, result.right)
  g.direct(r.top, result.top)
  g.direct(r.left, result.left)
  g.direct(r, result)
  return result
}

export function transformValue(m: Matrix3, v: Value, g: LineageGraph): Value {
  switch (v.type) {
    case 'point2': return transformPt(m, v, g)
    case 'edge2': return transformEdge(m, v, g)
    case 'rectangle': return transformRectangle(m, v, g)
    default: throw new Error(`Cannot transform ${v.type}`)
  }
}
