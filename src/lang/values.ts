import type { Expression } from '@/lang/ast'
import type { LineageGraph } from '@/lang/lineage'

// ---------------------------------------------------------------------------
// Geometric primitives (plain data, used by store + renderer)
// ---------------------------------------------------------------------------

export interface Point2 {
  x: number
  y: number
}

export interface Edge2 {
  start: Point2
  end: Point2
}

// ---------------------------------------------------------------------------
// Runtime values
// ---------------------------------------------------------------------------

export interface NumberVal {
  type: 'number'
  value: number
}

export interface NullVal {
  type: 'null'
}

export interface StyleVal {
  type: 'style'
  fill?: string
  stroke?: string
  opacity?: number
  dashed?: boolean
}

export interface Point2Val {
  type: 'point2'
  x: number
  y: number
}

export interface Edge2Val {
  type: 'edge2'
  start: Point2Val
  end: Point2Val
}

export interface RectangleVal {
  type: 'rectangle'
  x: number
  y: number
  width: number
  height: number
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

export interface ArrayVal {
  type: 'array'
  elements: Value[]
}

export interface LambdaVal {
  type: 'lambda'
  params: string[]
  body: Expression
}

export interface BuiltinFnVal {
  type: 'builtin'
  name: string
  fn: (args: Value[]) => Value
}

export interface QueryVal {
  type: 'query'
  test: (candidate: Value) => boolean
}

type RawValue =
  | NumberVal
  | NullVal
  | StyleVal
  | Point2Val
  | Edge2Val
  | RectangleVal
  | ArrayVal
  | LambdaVal
  | BuiltinFnVal
  | QueryVal

export type Value = RawValue & { sourceText?: string }

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const createNumber = (value: number): NumberVal => ({ type: 'number', value })

export const NULL: NullVal = { type: 'null' }

export const createPoint = (x: number, y: number): Point2Val => ({ type: 'point2', x, y })

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
  return {
    type: 'rectangle',
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    bottomLeft: bl, bottomRight: br, topLeft: tl, topRight: tr,
    bottom, right, top, left,
    points: [bl, br, tr, tl],
    edges: [bottom, right, top, left],
  }
}

export function constructRectangle(x: number, y: number, w: number, h: number, g: LineageGraph): RectangleVal {
  const bl = createPoint(x, y)
  const br = createPoint(x + w, y)
  const tl = createPoint(x, y + h)
  const tr = createPoint(x + w, y + h)
  return createRectangle(bl, br, tl, tr, g)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isTruthy(v: Value): boolean {
  if (v.type === 'null') return false
  if (v.type === 'number') return v.value !== 0
  return true
}

export function asNumber(v: Value, context: string): number {
  if (v.type !== 'number') throw new Error(`Expected number in ${context}, got ${v.type}`)
  return v.value
}

export function asString(v: Value, context: string): string {
  if (v.type === 'null' && v.sourceText !== undefined) return v.sourceText
  if (v.type === 'number') return String(v.value)
  throw new Error(`Expected string in ${context}, got ${v.type}`)
}

export function showValue(v: Value): string {
  switch (v.type) {
    case 'number': return String(v.value)
    case 'null': return v.sourceText ?? 'null'
    case 'style': return `<style>`
    case 'point2': return `pt(${v.x}, ${v.y})`
    case 'edge2': return `edge(${v.start.x},${v.start.y} -> ${v.end.x},${v.end.y})`
    case 'rectangle': return `rect(${v.x}, ${v.y}, ${v.width}, ${v.height})`
    case 'array': return `[${v.elements.map(showValue).join(', ')}]`
    case 'lambda': return `<lambda(${v.params.join(', ')})>`
    case 'builtin': return `<builtin:${v.name}>`
    case 'query': return `<query>`
  }
}
