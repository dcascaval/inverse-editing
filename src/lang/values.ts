import type { Expression } from '@/lang/ast'

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
  start: Point2
  end: Point2
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

export type Value = RawValue & { sourceText?: string }

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const createNumber = (value: number): NumberVal => ({ type: 'number', value })

export const NULL: NullVal = { type: 'null' }

export const createPooint = (x: number, y: number): Point2Val => ({ type: 'point2', x, y })

export const createEdge = (start: Point2, end: Point2): Edge2Val => ({
  type: 'edge2',
  start,
  end,
})

export function createRectangle(x: number, y: number, w: number, h: number): RectangleVal {
  const bl: Point2Val = createPooint(x, y)
  const br: Point2Val = createPooint(x + w, y)
  const tl: Point2Val = createPooint(x, y + h)
  const tr: Point2Val = createPooint(x + w, y + h)
  const bottom: Edge2Val = createEdge(bl, br)
  const right: Edge2Val = createEdge(br, tr)
  const top: Edge2Val = createEdge(tr, tl)
  const left: Edge2Val = createEdge(tl, bl)
  return {
    type: 'rectangle',
    x, y, width: w, height: h,
    bottomLeft: bl, bottomRight: br, topLeft: tl, topRight: tr,
    bottom, right, top, left,
    points: [bl, br, tr, tl],
    edges: [bottom, right, top, left],
  }
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
  }
}
