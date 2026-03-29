import { type Value, showValue } from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'
import { containedElements } from '@/lang/lineage'


// Query ADT


export type FromQuery = {
  kind: 'from'
  sources: Value[]
  direct: boolean
}

export type FromAnyQuery = {
  kind: 'fromAny'
  sources: Value[]
  direct: boolean
}

export type ContainsQuery = {
  kind: 'contains'
  inner: Query
}

export type NotQuery = {
  kind: 'not'
  inner: Query
}

export type AndQuery = {
  kind: 'and'
  left: Query
  right: Query
}

export type OrQuery = {
  kind: 'or'
  left: Query
  right: Query
}

export type Query =
  | FromQuery
  | FromAnyQuery
  | ContainsQuery
  | NotQuery
  | AndQuery
  | OrQuery


// Constructors

export const from = (parents: Value[]): Query =>
  ({ kind: 'from', sources: parents, direct: true })

export const fromAny = (parents: Value[]): Query =>
  ({ kind: 'fromAny', sources: parents, direct: true })

export const derivedFrom = (parents: Value[]): Query =>
  ({ kind: 'from', sources: parents, direct: false })

export const derivedFromAny = (parents: Value[]): Query =>
  ({ kind: 'fromAny', sources: parents, direct: false })

export const contains = (inner: Query): Query =>
  ({ kind: 'contains', inner })

export const not = (inner: Query): Query =>
  ({ kind: 'not', inner })

export const and = (left: Query, right: Query): Query =>
  ({ kind: 'and', left, right })

export const or = (left: Query, right: Query): Query =>
  ({ kind: 'or', left, right })


function matches(candidate: Value, q: Query, g: LineageGraph): boolean {
  switch (q.kind) {
    case 'from':
      return g.isReachableAll(
        candidate,
        q.sources.map((a) => new Set(containedElements(a))),
        q.direct,
      )
    case 'fromAny':
      return g.isReachable(
        candidate,
        new Set(q.sources.flatMap(containedElements)),
        q.direct,
      )
    case 'contains':
      return containedElements(candidate).some((el) => matches(el, q.inner, g))
    case 'not':
      return !matches(candidate, q.inner, g)
    case 'and':
      return matches(candidate, q.left, g) && matches(candidate, q.right, g)
    case 'or':
      return matches(candidate, q.left, g) || matches(candidate, q.right, g)
  }
}

export function evaluateQuery(collection: Value[], q: Query, g: LineageGraph): Value[] {
  return collection.filter((el) => matches(el, q, g))
}

function showParents(parents: Value[]): string {
  return parents.map(showValue).join(', ')
}

export function showQuery(q: Query): string {
  switch (q.kind) {
    case 'from':
      return q.direct
        ? `from(${showParents(q.sources)})`
        : `derivedFrom(${showParents(q.sources)})`
    case 'fromAny':
      return q.direct
        ? `fromAny(${showParents(q.sources)})`
        : `derivedFromAny(${showParents(q.sources)})`
    case 'contains':
      return `contains(${showQuery(q.inner)})`
    case 'not':
      return `not(${showQuery(q.inner)})`
    case 'and':
      return `(${showQuery(q.left)} and ${showQuery(q.right)})`
    case 'or':
      return `(${showQuery(q.left)} or ${showQuery(q.right)})`
  }
}
