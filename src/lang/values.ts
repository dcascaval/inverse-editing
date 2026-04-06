import type { Expression } from '@/lang/ast'
import type { LineageGraph } from '@/lang/lineage'
import { type Query, showQuery } from '@/lang/query'
import { type NumericValue, real } from '@/lang/numeric'
import { DualValue, type Tape } from '@/lang/grad'


// Geometric primitives (plain data, used by store + renderer)
export type Point2 = {
  x: number
  y: number
}

export type Edge2 = {
  start: Point2
  end: Point2
}


// Runtime values
export type NumberVal = {
  type: 'number'
  value: NumericValue
}

export type NullVal = {
  type: 'null'
}

export type StyleVal = {
  type: 'style'
  fill?: string
  stroke?: string
  opacity?: number
  dashed?: boolean
}

export type Point2Val = {
  type: 'point2'
  x: NumericValue
  y: NumericValue
}

export type Edge2Val = {
  type: 'edge2'
  start: Point2Val
  end: Point2Val
}

export type RectangleVal = {
  type: 'rectangle'
  x: NumericValue
  y: NumericValue
  width: NumericValue
  height: NumericValue
  bottomLeft: Point2Val
  bottomRight: Point2Val
  topLeft: Point2Val
  topRight: Point2Val
  bottom: Edge2Val
  right: Edge2Val
  top: Edge2Val
  left: Edge2Val
  points: Point2Val[]
  edges: Edge2Val[]
}

export type PolygonVal = {
  type: 'polygon'
  points: Point2Val[]
  edges: Edge2Val[]
}

export type RegionVal = {
  type: 'region'
  positive: PolygonVal[]
  negative: PolygonVal[]
}

export type ArrayVal = {
  type: 'array'
  elements: Value[]
}

export type LambdaVal = {
  type: 'lambda'
  params: string[]
  body: Expression
}

export type BuiltinFnVal = {
  type: 'builtin'
  name: string
  fn: (args: Value[]) => Value
}

export type OperationVal = {
  type: 'operation'
  name: string
  params: string[]
  body: Expression[]
}

export type ScopeVal = {
  type: 'scope'
  bindings: Map<string, Value>
}

export type QueryVal = {
  type: 'query'
  query: Query
}

type RawValue =
  | NumberVal
  | NullVal
  | StyleVal
  | Point2Val
  | Edge2Val
  | RectangleVal
  | PolygonVal
  | RegionVal
  | ArrayVal
  | LambdaVal
  | OperationVal
  | ScopeVal
  | BuiltinFnVal
  | QueryVal

export type Value = RawValue & { sourceText?: string }


// Constructors

function toNV(v: NumericValue | number): NumericValue {
  return typeof v === 'number' ? real(v) : v
}

export function createNumber(value: NumericValue | number, tape?: Tape | null, paramName?: string): NumberVal {
  if (tape && typeof value === 'number') {
    const index = paramName ? tape.pushParam(paramName, value) : tape.pushConst(value)
    return { type: 'number', value: new DualValue(tape, index) }
  }
  return { type: 'number', value: toNV(value) }
}

export const createNull = (): NullVal => ({ type: 'null' })

export const createPoint = (x: NumericValue | number, y: NumericValue | number): Point2Val =>
  ({ type: 'point2', x: toNV(x), y: toNV(y) })

export function createEdge(start: Point2Val, end: Point2Val, g: LineageGraph): Edge2Val {
  const e: Edge2Val = { type: 'edge2', start, end }
  g.indirect([start, end], e)
  return e
}

export function createRectangle(
  bl: Point2Val, br: Point2Val, tl: Point2Val, tr: Point2Val,
  g: LineageGraph,
): RectangleVal {
  const bottom = createEdge(bl, br, g)
  const right = createEdge(br, tr, g)
  const top = createEdge(tr, tl, g)
  const left = createEdge(tl, bl, g)
  const xs = [bl.x, br.x, tl.x, tr.x]
  const ys = [bl.y, br.y, tl.y, tr.y]
  const xMin = xs.reduce((a, b) => a.min(b))
  const yMin = ys.reduce((a, b) => a.min(b))
  const xMax = xs.reduce((a, b) => a.max(b))
  const yMax = ys.reduce((a, b) => a.max(b))
  return {
    type: 'rectangle',
    x: xMin, y: yMin,
    width: xMax.sub(xMin),
    height: yMax.sub(yMin),
    bottomLeft: bl, bottomRight: br, topLeft: tl, topRight: tr,
    bottom, right, top, left,
    points: [bl, br, tr, tl],
    edges: [bottom, right, top, left],
  }
}

export function createPolygon(points: Point2Val[], g: LineageGraph): PolygonVal {
  const edges: Edge2Val[] = []
  for (let i = 0; i < points.length; i++) {
    edges.push(createEdge(points[i], points[(i + 1) % points.length], g))
  }
  return { type: 'polygon', points, edges }
}

export function constructRectangle(
  x: NumericValue, y: NumericValue, w: NumericValue, h: NumericValue,
  g: LineageGraph,
): RectangleVal {
  // Normalize so corners are always CCW regardless of sign of w/h
  const xw = x.add(w)
  const yh = y.add(h)
  const x0 = x.min(xw)
  const y0 = y.min(yh)
  const x1 = x.max(xw)
  const y1 = y.max(yh)
  const bl = createPoint(x0, y0)
  const br = createPoint(x1, y0)
  const tl = createPoint(x0, y1)
  const tr = createPoint(x1, y1)
  return createRectangle(bl, br, tl, tr, g)
}


// Helpers
export function asNumber(v: Value, context: string): number {
  if (v.type !== 'number') throw new Error(`Expected number in ${context}, got ${v.type}`)
  return v.value.toNumber()
}

export function asNumeric(v: Value, context: string): NumericValue {
  if (v.type !== 'number') throw new Error(`Expected number in ${context}, got ${v.type}`)
  return v.value
}

export function asString(v: Value, context: string): string {
  if (v.type === 'null' && v.sourceText !== undefined) return v.sourceText
  if (v.type === 'number') return String(v.value.toNumber())
  throw new Error(`Expected string in ${context}, got ${v.type}`)
}

export function showValue(v: Value): string {
  switch (v.type) {
    case 'number': return String(v.value.toNumber())
    case 'null': return v.sourceText ?? 'null'
    case 'style': return `<style>`
    case 'point2': return `pt(${v.x.toNumber()}, ${v.y.toNumber()})`
    case 'edge2': return `edge(${v.start.x.toNumber()},${v.start.y.toNumber()} -> ${v.end.x.toNumber()},${v.end.y.toNumber()})`
    case 'rectangle': return `rect(${v.x.toNumber()}, ${v.y.toNumber()}, ${v.width.toNumber()}, ${v.height.toNumber()})`
    case 'polygon': return `<polygon(${v.points.length} pts)>`
    case 'region': return `<region(${v.positive.length}+, ${v.negative.length}-)>`
    case 'array': return `[${v.elements.map(showValue).join(', ')}]`
    case 'lambda': return `<lambda(${v.params.join(', ')})>`
    case 'operation': return `<operation ${v.name}(${v.params.join(', ')})>`
    case 'scope': return `<scope(${[...v.bindings.keys()].join(', ')})>`
    case 'builtin': return `<builtin:${v.name}>`
    case 'query': return showQuery(v.query)
  }
}
