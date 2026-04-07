import type {
  Value,
  NumberVal,
  StyleVal,
  Point2Val,
  Edge2Val,
  RectangleVal,
  PolygonVal,
  RegionVal,
  Point3Val,
  Edge3Val,
  Polygon3Val,
  PlanarFace3Val,
  Face3Val,
  ExtrusionVal,
  ArrayVal,
  BuiltinFnVal,
} from '@/lang/values'


// Type tags — phantom-typed so `sig` callbacks infer correct arg types


export type TypeTag<V extends Value = Value> = {
  readonly label: string
  match(v: Value): v is V
}

function tag<V extends Value>(label: string, type: V['type']): TypeTag<V> {
  return { label, match: (v): v is V => v.type === type }
}

export const Num: TypeTag<NumberVal> = tag('number', 'number')
export const Sty: TypeTag<StyleVal> = tag('style', 'style')
export const Pt2: TypeTag<Point2Val> = tag('point2', 'point2')
export const Edg: TypeTag<Edge2Val> = tag('edge2', 'edge2')
export const Rct: TypeTag<RectangleVal> = tag('rectangle', 'rectangle')
export const Pgn: TypeTag<PolygonVal> = tag('polygon', 'polygon')
export const Rgn: TypeTag<RegionVal> = tag('region', 'region')
export const Pt3: TypeTag<Point3Val> = tag('point3', 'point3')
export const Edg3: TypeTag<Edge3Val> = tag('edge3', 'edge3')
export const Pgn3: TypeTag<Polygon3Val> = tag('polygon3', 'polygon3')
export const PlFce3: TypeTag<PlanarFace3Val> = tag('planarface3', 'planarface3')
export const Fce3: TypeTag<Face3Val> = tag('face3', 'face3')
export const Ext: TypeTag<ExtrusionVal> = tag('extrusion', 'extrusion')
export const Arr: TypeTag<ArrayVal> = tag('array', 'array')
export const Any: TypeTag<Value> = { label: 'any', match: (_v): _v is Value => true }


// Overload signatures


type Infer<T extends readonly TypeTag[]> = {
  [K in keyof T]: T[K] extends TypeTag<infer V> ? V : never
}

type Overload = {
  readonly tags: readonly TypeTag[]
  readonly fn: (...args: never[]) => Value
}

export function signature<const T extends readonly TypeTag[]>(
  tags: T,
  fn: (...args: Infer<T>) => Value,
): Overload {
  return { tags, fn: fn as Overload['fn'] }
}


// Build an overloaded builtin


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
