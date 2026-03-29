import type {
  Value,
  NumberVal,
  Point2Val,
  Edge2Val,
  RectangleVal,
  ArrayVal,
  BuiltinFnVal,
} from '@/lang/values'

// ---------------------------------------------------------------------------
// Type tags — phantom-typed so `sig` callbacks infer correct arg types
// ---------------------------------------------------------------------------

export interface TypeTag<V extends Value = Value> {
  readonly label: string
  match(v: Value): v is V
}

function tag<V extends Value>(label: string, type: V['type']): TypeTag<V> {
  return { label, match: (v): v is V => v.type === type }
}

export const Num: TypeTag<NumberVal> = tag('number', 'number')
export const Pt2: TypeTag<Point2Val> = tag('point2', 'point2')
export const Edg: TypeTag<Edge2Val> = tag('edge2', 'edge2')
export const Rct: TypeTag<RectangleVal> = tag('rectangle', 'rectangle')
export const Arr: TypeTag<ArrayVal> = tag('array', 'array')
export const Any: TypeTag<Value> = { label: 'any', match: (_v): _v is Value => true }

// ---------------------------------------------------------------------------
// Overload signatures
// ---------------------------------------------------------------------------

type Infer<T extends readonly TypeTag[]> = {
  [K in keyof T]: T[K] extends TypeTag<infer V> ? V : never
}

interface Overload {
  readonly tags: readonly TypeTag[]
  readonly fn: (...args: never[]) => Value
}

export function sig<const T extends readonly TypeTag[]>(
  tags: T,
  fn: (...args: Infer<T>) => Value,
): Overload {
  return { tags, fn: fn as Overload['fn'] }
}

// ---------------------------------------------------------------------------
// Build an overloaded builtin
// ---------------------------------------------------------------------------

export function overloaded(name: string, overloads: Overload[]): BuiltinFnVal {
  return {
    type: 'builtin',
    name,
    fn: (args: Value[]) => {
      for (const o of overloads) {
        if (
          args.length === o.tags.length &&
          o.tags.every((t, i) => t.match(args[i]))
        ) {
          return (o.fn as (...a: Value[]) => Value)(...args)
        }
      }

      const got = args.map((a) => a.type).join(', ')
      const expected = overloads
        .map((o) => `(${o.tags.map((t) => t.label).join(', ')})`)
        .join(' | ')
      throw new Error(`${name}: no matching overload for (${got}), expected ${expected}`)
    },
  }
}
