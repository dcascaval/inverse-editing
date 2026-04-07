import type { Value } from '@/lang/values'

export type EdgeType = 'direct' | 'indirect'

/** Returns the value and all elements it structurally contains. */
export function containedElements(v: Value): Value[] {
  switch (v.type) {
    case 'edge2':
      return [v, v.start, v.end]
    case 'edge3':
      return [v, v.start, v.end]
    case 'polygon3':
      return [v, ...v.points, ...v.edges]
    case 'planarface3': {
      const all: Value[] = [v]
      for (const p of [...v.positive, ...v.negative]) all.push(...containedElements(p))
      return all
    }
    case 'face3':
      return [v, ...containedElements(v.bottomEdge)]
    case 'extrusion': {
      const all: Value[] = [v]
      for (const e of v.bottomEdges) all.push(...containedElements(e))
      for (const e of v.topEdges) all.push(...containedElements(e))
      for (const e of v.verticalEdges) all.push(...containedElements(e))
      for (const f of v.verticalFaces) all.push(...containedElements(f))
      all.push(...containedElements(v.bottomFace))
      all.push(...containedElements(v.topFace))
      return all
    }
    case 'rectangle':
      return [v, ...v.points, ...v.edges]
    case 'polygon':
      return [v, ...v.points, ...v.edges]
    case 'region': {
      const all: Value[] = [v]
      for (const p of [...v.positive, ...v.negative]) {
        all.push(...containedElements(p))
      }
      return all
    }
    default:
      return [v]
  }
}

export class LineageGraph {
  // child -> parent maps (traversal goes from candidate toward ancestors)
  private directParents = new Map<Value, Value[]>()
  private allParents = new Map<Value, Value[]>()

  direct(parents: Value | Value[], children: Value | Value[]) {
    this.link(parents, children, 'direct')
  }

  indirect(parents: Value | Value[], children: Value | Value[]) {
    this.link(parents, children, 'indirect')
  }

  link(
    parents: Value | Value[],
    children: Value | Value[],
    type: EdgeType,
  ) {
    const ps = Array.isArray(parents) ? parents : [parents]
    const cs = Array.isArray(children) ? children : [children]
    for (const c of cs) {
      for (const p of ps) {
        this.addTo(this.allParents, c, p)
        if (type === 'direct') {
          this.addTo(this.directParents, c, p)
        }
      }
    }
  }

  private addTo(map: Map<Value, Value[]>, key: Value, val: Value) {
    let list = map.get(key)
    if (!list) {
      list = []
      map.set(key, list)
    }
    list.push(val)
  }

  /** BFS toward ancestors: true if ANY target is reachable from start */
  isReachable(start: Value, targets: Set<Value>, directOnly: boolean): boolean {
    if (targets.has(start)) return true
    const parents = directOnly ? this.directParents : this.allParents
    const seen = new Set<Value>()
    const queue: Value[] = [start]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      const ps = parents.get(current)
      if (!ps) continue
      for (const p of ps) {
        if (targets.has(p)) return true
        if (!seen.has(p)) queue.push(p)
      }
    }
    return false
  }

  /** BFS toward ancestors: true if ALL target sets have at least one reachable element */
  isReachableAll(start: Value, targetSets: Set<Value>[], directOnly: boolean): boolean {
    if (targetSets.length === 0) return true
    const parents = directOnly ? this.directParents : this.allParents
    const unseen = new Set(targetSets)
    for (const ts of unseen) {
      if (ts.has(start)) unseen.delete(ts)
    }
    if (unseen.size === 0) return true
    const seen = new Set<Value>()
    const queue: Value[] = [start]
    while (queue.length > 0 && unseen.size > 0) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      const ps = parents.get(current)
      if (!ps) continue
      for (const p of ps) {
        if (!seen.has(p)) {
          for (const ts of unseen) {
            if (ts.has(p)) unseen.delete(ts)
          }
          if (unseen.size === 0) return true
          queue.push(p)
        }
      }
    }
    return unseen.size === 0
  }
}
