import {
  type Value,
  type Point2Val,
  type Edge2Val,
  type PolygonVal,
  type RegionVal,
  createPoint,
  createPolygon,
  nv,
} from '@/lang/values'
import type { NumericValue } from '@/lang/numeric'
import type { Tape } from '@/lang/grad'
import type { LineageGraph } from '@/lang/lineage'
import { pointInPolygon } from '@/geometry/polygon'

const EPS = 1e-10
const MATCH_EPS = 1e-6
const SEG_TOL = 1e-6
const SEG_TOL_SQ = SEG_TOL * SEG_TOL


type NVec2 = { x: NumericValue; y: NumericValue }

type SubEdge = {
  start: Point2Val
  end: Point2Val
  srcEdge: Edge2Val
  srcPoly: 0 | 1
}

type PolyData = {
  points: Point2Val[]
  edges: Edge2Val[]
}


// ---- Geometry utilities ----

function xn(p: NVec2): number { return p.x.toNumber() }
function yn(p: NVec2): number { return p.y.toNumber() }

function toPlain(p: NVec2): { x: number; y: number } {
  return { x: xn(p), y: yn(p) }
}

function samePoint(a: NVec2, b: NVec2): boolean {
  return Math.abs(xn(a) - xn(b)) < MATCH_EPS && Math.abs(yn(a) - yn(b)) < MATCH_EPS
}

function signedArea2(pts: NVec2[]): number {
  let sum = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += xn(pts[i]) * yn(pts[j]) - xn(pts[j]) * yn(pts[i])
  }
  return sum
}

/** Check if polygon `outer` fully contains polygon `inner`. */
function polyContainsPoly(outer: NVec2[], inner: NVec2[]): boolean {
  const outerPlain = outer.map(toPlain)
  return pointInPolygon(toPlain(inner[0]), outerPlain)
      && pointInPolygon(toPlain(inner[1]), outerPlain)
}

/** Interpolate between two NumericValue points: a + t * (b - a) */
function lerpNV(a: NVec2, b: NVec2, t: number, tape?: Tape | null): NVec2 {
  const tNV = nv(t, tape)
  return {
    x: a.x.add(b.x.sub(a.x).mul(tNV)),
    y: a.y.add(b.y.sub(a.y).mul(tNV)),
  }
}


type Intersection = {
  x: number
  y: number
  tA: number
  tB: number
}

function segSegIntersect(a1: NVec2, a2: NVec2, b1: NVec2, b2: NVec2): Intersection[] {
  const a1x = xn(a1), a1y = yn(a1)
  const a2x = xn(a2), a2y = yn(a2)
  const b1x = xn(b1), b1y = yn(b1)
  const b2x = xn(b2), b2y = yn(b2)

  const dax = a2x - a1x, day = a2y - a1y
  const dbx = b2x - b1x, dby = b2y - b1y
  const cross = dax * dby - day * dbx

  const lenA = Math.sqrt(dax * dax + day * day)
  const lenB = Math.sqrt(dbx * dbx + dby * dby)
  if (lenA < EPS || lenB < EPS) return []

  const crossNorm = Math.abs(cross) / (lenA * lenB)

  // Collinear / parallel case: add all end points
  if (crossNorm < Math.sqrt(SEG_TOL)) {
    const result: Intersection[] = []

    function addIntervalPoint(
      sx: number, sy: number, ex: number, ey: number,
      ptx: number, pty: number,
      isFromA: boolean, isEnd: boolean,
    ) {
      const dx = ex - sx, dy = ey - sy
      const len2 = dx * dx + dy * dy
      const t = len2 < EPS * EPS ? 0 : ((ptx - sx) * dx + (pty - sy) * dy) / len2
      const projx = sx + t * dx, projy = sy + t * dy
      const pdx = projx - ptx, pdy = projy - pty
      if (pdx * pdx + pdy * pdy > SEG_TOL_SQ) return
      const constParam = isEnd ? 1.0 : 0.0
      const tA = isFromA ? constParam : t
      const tB = isFromA ? t : constParam
      if (tA >= -SEG_TOL && tA <= 1 + SEG_TOL && tB >= -SEG_TOL && tB <= 1 + SEG_TOL) {
        result.push({
          x: ptx, y: pty,
          tA: Math.max(0, Math.min(1, tA)),
          tB: Math.max(0, Math.min(1, tB)),
        })
      }
    }

    addIntervalPoint(b1x, b1y, b2x, b2y, a1x, a1y, true, false)
    addIntervalPoint(b1x, b1y, b2x, b2y, a2x, a2y, true, true)
    addIntervalPoint(a1x, a1y, a2x, a2y, b1x, b1y, false, false)
    addIntervalPoint(a1x, a1y, a2x, a2y, b2x, b2y, false, true)

    return result
  }

  // Normal case
  const t = ((b1x - a1x) * dby - (b1y - a1y) * dbx) / cross
  const u = ((b1x - a1x) * day - (b1y - a1y) * dax) / cross
  if (t < -SEG_TOL || t > 1 + SEG_TOL || u < -SEG_TOL || u > 1 + SEG_TOL) return []
  const tc = Math.max(0, Math.min(1, t))
  const uc = Math.max(0, Math.min(1, u))
  return [{
    x: a1x + tc * dax,
    y: a1y + tc * day,
    tA: tc,
    tB: uc,
  }]
}


// Intersection finding

type EdgeIntersection = { point: Point2Val; param: number }

function findAllIntersections(
  polyA: PolyData, polyB: PolyData,
  g: LineageGraph, tape?: Tape | null,
): { ixMap: Map<Edge2Val, EdgeIntersection[]>; hasIntersections: boolean } {
  const ixMap = new Map<Edge2Val, EdgeIntersection[]>()
  let hasIntersections = false

  for (let i = 0; i < polyA.edges.length; i++) {
    const aEdge = polyA.edges[i]
    const a0 = polyA.points[i], a1 = polyA.points[(i + 1) % polyA.points.length]

    for (let j = 0; j < polyB.edges.length; j++) {
      const bEdge = polyB.edges[j]
      const b0 = polyB.points[j], b1 = polyB.points[(j + 1) % polyB.points.length]

      for (const ix of segSegIntersect(a0, a1, b0, b1)) {
        hasIntersections = true

        // Create intersection point via lerp on A's edge, apply lineage from both edges
        const lerped = lerpNV(a0, a1, ix.tA, tape)
        const pt = createPoint(lerped.x, lerped.y)
        g.direct(aEdge, pt)
        g.direct(bEdge, pt)

        let aList = ixMap.get(aEdge)
        if (!aList) { aList = []; ixMap.set(aEdge, aList) }
        aList.push({ point: pt, param: ix.tA })

        let bList = ixMap.get(bEdge)
        if (!bList) { bList = []; ixMap.set(bEdge, bList) }
        bList.push({ point: pt, param: ix.tB })
      }
    }
  }

  return { ixMap, hasIntersections }
}


// Edge splitting
function splitPoly(
  poly: PolyData, polyId: 0 | 1,
  ixMap: Map<Edge2Val, EdgeIntersection[]>,
  g: LineageGraph,
): SubEdge[] {
  const result: SubEdge[] = []
  const n = poly.points.length

  for (let i = 0; i < n; i++) {
    const p0 = poly.points[i]
    const p1 = poly.points[(i + 1) % n]
    const srcEdge = poly.edges[i]

    const ixs = (ixMap.get(srcEdge) || [])
      .filter((ix) => ix.param > EPS && ix.param < 1 - EPS)
    ixs.sort((a, b) => a.param - b.param)

    // Dedup by proximity
    const unique: EdgeIntersection[] = []
    for (const ix of ixs) {
      if (unique.length > 0 && samePoint(unique[unique.length - 1].point, ix.point)) continue
      unique.push(ix)
    }

    // Create sub-edges
    let prev = p0
    for (const ix of unique) {
      result.push({ start: prev, end: ix.point, srcEdge, srcPoly: polyId })
      prev = ix.point
    }
    result.push({ start: prev, end: p1, srcEdge, srcPoly: polyId })
  }

  return result
}


// Edge deduplication and filtering

function sameEdge(a: SubEdge, b: SubEdge): boolean {
  return samePoint(a.start, b.start) && samePoint(a.end, b.end)
}

function reverseOfEdge(a: SubEdge, b: SubEdge): boolean {
  return samePoint(a.start, b.end) && samePoint(a.end, b.start)
}

function deduplicateAndFilter(
  subEdgesA: SubEdge[], subEdgesB: SubEdge[],
  polyA: PolyData, polyB: PolyData,
  op: BooleanOp,
  g: LineageGraph,
): SubEdge[] {
  const edgesOnBoth: SubEdge[] = []
  let allEdges: SubEdge[] = []

  function insert(edge: SubEdge) {
    const eqIdx = allEdges.findIndex((e) => sameEdge(e, edge))
    if (eqIdx >= 0) {
      const matched = allEdges[eqIdx]
      allEdges.splice(eqIdx, 1)
      // Both edges occupy the same space — unify lineage from the discarded
      // edge's endpoints into the kept edge's endpoints so provenance from
      // both source polygons is preserved
      g.direct(edge.start, matched.start)
      g.direct(edge.end, matched.end)
      g.direct(matched.start, edge.start)
      g.direct(matched.end, edge.end)
      switch (op) {
        case 'union':        edgesOnBoth.push(matched); return
        case 'intersection': edgesOnBoth.push(matched); return
        case 'difference':   return
      }
    }

    const revIdx = allEdges.findIndex((e) => reverseOfEdge(e, edge))
    if (revIdx >= 0) {
      const matched = allEdges[revIdx]
      allEdges.splice(revIdx, 1)
      // Reversed edges share endpoints in opposite order
      g.direct(edge.start, matched.end)
      g.direct(edge.end, matched.start)
      g.direct(matched.start, edge.end)
      g.direct(matched.end, edge.start)
      switch (op) {
        case 'union':        return
        case 'intersection': return
        case 'difference':   edgesOnBoth.push(matched); return
      }
    }

    allEdges.push(edge)
  }

  for (const e of subEdgesA) insert(e)
  for (const e of subEdgesB) insert(e)

  const polyAPlain = polyA.points.map(toPlain)
  const polyBPlain = polyB.points.map(toPlain)

  const filtered: SubEdge[] = []
  for (const e of allEdges) {
    const mid = {
      x: (xn(e.start) + xn(e.end)) / 2,
      y: (yn(e.start) + yn(e.end)) / 2,
    }

    let keep: boolean
    if (e.srcPoly === 0) {
      const inB = pointInPolygon(mid, polyBPlain)
      keep = (op === 'intersection') ? inB : !inB
    } else {
      const inA = pointInPolygon(mid, polyAPlain)
      keep = (op === 'union') ? !inA : inA
    }

    if (keep) filtered.push(e)
  }

  filtered.push(...edgesOnBoth)

  return filtered.map((e) => {
    if (op === 'difference' && e.srcPoly === 1) {
      const flipped: SubEdge = { start: e.end, end: e.start, srcEdge: e.srcEdge, srcPoly: e.srcPoly }
      return flipped
    }
    return e
  })
}


// Stitch up edges back into polygons
function reconstructLoops(edges: SubEdge[]): SubEdge[][] {
  if (edges.length === 0) return []

  // Precompute adjacency: adj[i] = edges whose start matches edges[i].end
  const adj: { idx: number; angle: number }[][] = edges.map((e) => {
    const result: { idx: number; angle: number }[] = []
    for (let j = 0; j < edges.length; j++) {
      if (samePoint(edges[j].start, e.end)) {
        const angle = Math.atan2(
          yn(edges[j].end) - yn(edges[j].start),
          xn(edges[j].end) - xn(edges[j].start),
        ) + Math.PI
        result.push({ idx: j, angle })
      }
    }
    result.sort((a, b) => a.angle - b.angle)
    return result
  })

  const unvisited = new Set<number>()
  for (let i = 0; i < edges.length; i++) unvisited.add(i)

  const loops: SubEdge[][] = []

  while (unvisited.size > 0) {
    // Prefer starting at a vertex with only one live outgoing edge
    let startIdx: number | undefined
    for (const idx of unvisited) {
      const liveCount = adj[idx].filter((e) => unvisited.has(e.idx)).length
      if (liveCount === 1) { startIdx = idx; break }
    }
    if (startIdx === undefined) {
      startIdx = unvisited.values().next().value!
    }

    const loop: SubEdge[] = []
    let currentIdx = startIdx
    const startPt = edges[startIdx].start

    while (true) {
      unvisited.delete(currentIdx)
      const e = edges[currentIdx]
      loop.push(e)

      if (samePoint(e.end, startPt)) break

      const outgoing = adj[currentIdx]

      const incomingAngle = (
        Math.atan2(yn(e.start) - yn(e.end), xn(e.start) - xn(e.end)) + Math.PI
      )

      let bestIdx = -1
      let bestAngle = -Infinity
      let fallbackIdx = -1
      let fallbackAngle = -Infinity

      for (const out of outgoing) {
        if (!unvisited.has(out.idx)) continue
        if (out.angle < incomingAngle - EPS && out.angle > bestAngle) {
          bestAngle = out.angle
          bestIdx = out.idx
        }
        if (out.angle > fallbackAngle) {
          fallbackAngle = out.angle
          fallbackIdx = out.idx
        }
      }

      const nextIdx = bestIdx >= 0 ? bestIdx : fallbackIdx
      if (nextIdx < 0) break
      currentIdx = nextIdx
    }

    if (loop.length >= 3 && samePoint(loop[loop.length - 1].end, startPt)) {
      loops.push(loop)
    }
  }

  return loops
}


// Collinear merging 

function isCollinear(a: SubEdge, b: SubEdge): boolean {
  const dax = xn(a.end) - xn(a.start), day = yn(a.end) - yn(a.start)
  const dbx = xn(b.end) - xn(b.start), dby = yn(b.end) - yn(b.start)
  return Math.abs(dax * dby - day * dbx) < EPS
}

type MergedEdge = { subEdge: SubEdge; mergedFrom: SubEdge[] }

function mergeCollinearEdges(loop: SubEdge[], g: LineageGraph): MergedEdge[] {
  if (loop.length <= 3) return loop.map((e) => ({ subEdge: e, mergedFrom: [e] }))

  const merged: MergedEdge[] = []

  for (const e of loop) {
    if (merged.length > 0 && isCollinear(merged[merged.length - 1].subEdge, e)) {
      const prev = merged[merged.length - 1]
      prev.subEdge = { ...prev.subEdge, end: e.end }
      prev.mergedFrom.push(e)
    } else {
      merged.push({ subEdge: e, mergedFrom: [e] })
    }
  }

  if (merged.length > 1 && isCollinear(merged[merged.length - 1].subEdge, merged[0].subEdge)) {
    const last = merged.pop()!
    merged[0].subEdge = { ...merged[0].subEdge, start: last.subEdge.start }
    merged[0].mergedFrom = [...last.mergedFrom, ...merged[0].mergedFrom]
  }

  return merged
}

function buildOutputPolygon(mergedLoop: MergedEdge[], g: LineageGraph): PolygonVal {
  const n = mergedLoop.length

  // Each output vertex is the start of edge[i] AND the end of edge[i-1]. These may be different
  // Point2Val objects (from different source polygons) that coincide spatially.
  // We propagate lineage from both to preserve reachability
  const points: Point2Val[] = mergedLoop.map((m, i) => {
    const pt = createPoint(m.subEdge.start.x, m.subEdge.start.y)
    g.direct(m.subEdge.start, pt)
    // Also propagate lineage from the previous merged group's end point
    const prevMerged = mergedLoop[(i - 1 + n) % n]
    const prevEnd = prevMerged.subEdge.end
    if (prevEnd !== m.subEdge.start) {
      g.direct(prevEnd, pt)
    }

    // TODO: intermediate points consumed by collinear merging (e.g. B in
    // [A -> B, B -> C] merged to [A -> C]) are dropped. open question:
    // do we propagate indirect lineage to surviving vertices?

    // for (let k = 0; k < m.mergedFrom.length - 1; k++) {
    //   g.direct(m.mergedFrom[k].end, pt)
    //   g.direct(m.mergedFrom[k + 1].start, pt)
    // }

    return pt
  })

  const poly = createPolygon(points, g)

  // Propagate direct lineage from all merged source edges to the output edge,
  // so that from(srcEdge) can find the output edge via direct BFS.
  for (let i = 0; i < mergedLoop.length; i++) {
    for (const sub of mergedLoop[i].mergedFrom) {
      g.direct(sub.srcEdge, poly.edges[i])
    }
  }

  return poly
}


function extractPoly(v: Value): PolyData {
  switch (v.type) {
    case 'rectangle':
    case 'polygon': {
      // Ensure CCW winding — mirrors and certain transforms can produce CW polygons,
      // which breaks the edge-filtering and loop-reconstruction logic.
      const area = signedArea2(v.points)
      if (area < 0) {
        // CW winding: reverse points and remap edges so edges[i] still
        // corresponds to the segment points[i] → points[(i+1) % n].
        // After reversing, new points[i] = old points[n-1-i], so the
        // segment between new[i] and new[i+1] was old edge[(n-2-i) % n].
        const n = v.points.length
        const pts = [...v.points].reverse()
        const edges = pts.map((_, i) => v.edges[(n - 2 - i + n) % n])
        return { points: pts, edges }
      }
      return { points: v.points, edges: v.edges }
    }
    default:
      throw new Error(`Cannot use ${v.type} in boolean operation`)
  }
}

export type BooleanOp = 'union' | 'difference' | 'intersection'

export function booleanOperation(
  a: Value, b: Value, op: BooleanOp, g: LineageGraph, tape?: Tape | null,
): RegionVal {
  const polyA = extractPoly(a)
  const polyB = extractPoly(b)

  // Find all intersections, creating Point2Val with lineage inline
  const { ixMap, hasIntersections } = findAllIntersections(polyA, polyB, g, tape)

  if (!hasIntersections) {
    const aInB = polyContainsPoly(polyB.points, polyA.points)
    const bInA = polyContainsPoly(polyA.points, polyB.points)

    switch (op) {
      case 'union':
        if (bInA) return buildSingleRegion(a, g)
        if (aInB) return buildSingleRegion(b, g)
        return buildTwoRegions(a, b, g)
      case 'difference':
        if (bInA) return buildDifferenceHole(a, b, g)
        if (aInB) return { type: 'region', positive: [], negative: [] }
        return buildSingleRegion(a, g)
      case 'intersection':
        if (bInA) return buildSingleRegion(b, g)
        if (aInB) return buildSingleRegion(a, g)
        return { type: 'region', positive: [], negative: [] }
    }
  }

  // Split both polygons at intersection points
  const splitA = splitPoly(polyA, 0, ixMap, g)
  const splitB = splitPoly(polyB, 1, ixMap, g)

  // Full boolean pipeline
  const finalEdges = deduplicateAndFilter(splitA, splitB, polyA, polyB, op, g)

  const loops = reconstructLoops(finalEdges)

  const positive: PolygonVal[] = []
  const negative: PolygonVal[] = []

  for (const loop of loops) {
    const merged = mergeCollinearEdges(loop, g)
    const poly = buildOutputPolygon(merged, g)

    const area = signedArea2(merged.map((m) => m.subEdge.start))
    if (area > EPS) positive.push(poly)
    else if (area < -EPS) negative.push(poly)
  }

  return { type: 'region', positive, negative }
}


function buildSingleRegion(v: Value, g: LineageGraph): RegionVal {
  const p = extractPoly(v)
  const pts = p.points.map((pt) => createPoint(pt.x, pt.y))
  for (let i = 0; i < pts.length; i++) g.direct(p.points[i], pts[i])
  const poly = createPolygon(pts, g)
  for (let i = 0; i < p.edges.length; i++) g.direct(p.edges[i], poly.edges[i])
  return { type: 'region', positive: [poly], negative: [] }
}

function buildTwoRegions(a: Value, b: Value, g: LineageGraph): RegionVal {
  const ra = buildSingleRegion(a, g)
  const rb = buildSingleRegion(b, g)
  return {
    type: 'region',
    positive: [...ra.positive, ...rb.positive],
    negative: [],
  }
}

function buildDifferenceHole(outer: Value, hole: Value, g: LineageGraph): RegionVal {
  const outerRegion = buildSingleRegion(outer, g)
  const h = extractPoly(hole)
  const pts = h.points.map((pt) => createPoint(pt.x, pt.y))
  for (let i = 0; i < pts.length; i++) g.direct(h.points[i], pts[i])
  const reversed = [...pts].reverse()
  const holePoly = createPolygon(reversed, g)
  for (let i = 0; i < h.edges.length; i++) g.direct(h.edges[i], holePoly.edges[i])
  return {
    type: 'region',
    positive: outerRegion.positive,
    negative: [holePoly],
  }
}


// Region-level boolean operations
// These compose polygon-level booleans to handle regions (positive + negative polygon sets).

function asRegion(poly: PolygonVal): RegionVal {
  return { type: 'region', positive: [poly], negative: [] }
}

function reverseWinding(poly: PolygonVal, g: LineageGraph): PolygonVal {
  const pts = [...poly.points].reverse()
  return createPolygon(pts, g)
}

/**
 * Merge a polygon into a region's positive/negative polygon lists.
 * Invariant: polygons within each list don't intersect each other.
 */
function addPolygonToRegion(
  positives: PolygonVal[],
  negatives: PolygonVal[],
  newPolygon: PolygonVal,
  g: LineageGraph,
  tape?: Tape | null,
): { positives: PolygonVal[]; negatives: PolygonVal[] } {
  const posResult: PolygonVal[] = []
  const newNegatives: PolygonVal[] = []

  let i = 0
  let done = false

  while (i < positives.length && !done) {
    const pos = positives[i]
    const union = booleanOperation(pos, newPolygon, 'union', g, tape)

    if (union.positive.length === 2 && union.negative.length === 0) {
      // They don't touch — keep the positive, try next
      posResult.push(pos)
      i++
    } else if (union.positive.length === 1 && union.negative.length === 0) {
      // They merged into a single polygon — recursively add to remaining
      done = true
      const remaining = positives.slice(i + 1)
      const rest = addPolygonToRegion(remaining, [], union.positive[0], g, tape)
      posResult.push(...rest.positives)
      newNegatives.push(...rest.negatives)
    } else {
      // They created a region with holes
      done = true
      const unionPos = union.positive[0]
      const unionNegs = union.negative
      const remaining = positives.slice(i + 1)
      const rest = addPolygonToRegion(remaining, [], unionPos, g, tape)
      posResult.push(...rest.positives)

      // Trim negative polygons by subtracting remaining positives from them
      const remainingRegion: RegionVal = { type: 'region', positive: remaining, negative: [] }
      for (const neg of unionNegs) {
        const trimmed = subtractRegions(asRegion(neg), remainingRegion, g, tape)
        newNegatives.push(...trimmed.positive)
      }
      newNegatives.push(...rest.negatives)
    }
  }

  if (!done) {
    // Didn't intersect any existing positive — add it
    posResult.push(newPolygon)
  }

  // Subtract the new polygon from existing negatives
  // (negatives are already CCW — callers must ensure this)
  const negResult: PolygonVal[] = []
  for (const neg of negatives) {
    const diff = booleanOperation(neg, newPolygon, 'difference', g, tape)
    negResult.push(...diff.positive)
  }

  return {
    positives: posResult,
    negatives: [...negResult, ...newNegatives],
  }
}

export function unionRegions(
  a: RegionVal, b: RegionVal, g: LineageGraph, tape?: Tape | null,
): RegionVal {
  // Fold in each of b's positive polygons
  // Reverse a's CW negatives to CCW so addPolygonToRegion can use them in boolean ops
  let pos = a.positive
  let neg = a.negative.map((n) => reverseWinding(n, g))
  for (const bPoly of b.positive) {
    const result = addPolygonToRegion(pos, neg, bPoly, g, tape)
    pos = result.positives
    neg = result.negatives
  }

  // Handle b's negatives (reverse CW->CCW for boolean ops):
  // 1. Subtract a's positives from b's negatives (what remains is in b but not a)
  const aPosRegion: RegionVal = { type: 'region', positive: a.positive, negative: [] }
  const negSubPos: PolygonVal[] = []
  for (const bNeg of b.negative) {
    const bNegCCW = reverseWinding(bNeg, g)
    const result = subtractRegions(asRegion(bNegCCW), aPosRegion, g, tape)
    negSubPos.push(...result.positive)
  }

  // 2. Intersect a's negatives with b's negatives (holes in both remain holes)
  const negAndNeg: PolygonVal[] = []
  for (const aNeg of a.negative) {
    for (const bNeg of b.negative) {
      const aNegCCW = reverseWinding(aNeg, g)
      const bNegCCW = reverseWinding(bNeg, g)
      const ix = booleanOperation(aNegCCW, bNegCCW, 'intersection', g, tape)
      negAndNeg.push(...ix.positive)
    }
  }

  return {
    type: 'region',
    positive: pos,
    negative: [...neg, ...negSubPos, ...negAndNeg],
  }
}

export function subtractRegions(
  a: RegionVal, b: RegionVal, g: LineageGraph, tape?: Tape | null,
): RegionVal {
  if (a.positive.length === 0) return { type: 'region', positive: [], negative: [] }

  // Double negatives: b's holes, within a's positive area (minus a's holes),
  // become additions to the result
  const doubleNegatives: PolygonVal[] = []
  if (b.negative.length > 0) {
    // Reverse CW negatives to CCW for boolean ops
    const aNegsCCW = a.negative.map((n) => reverseWinding(n, g))
    const aNegRegion: RegionVal = { type: 'region', positive: aNegsCCW, negative: [] }
    // Remove a's holes from b's holes
    const bNegsStillAround: PolygonVal[] = []
    for (const bNeg of b.negative) {
      const bNegCCW = reverseWinding(bNeg, g)
      const result = subtractRegions(asRegion(bNegCCW), aNegRegion, g, tape)
      bNegsStillAround.push(...result.positive)
    }
    // Intersect with a's positives
    for (const bNeg of bNegsStillAround) {
      for (const aPos of a.positive) {
        const ix = booleanOperation(bNeg, aPos, 'intersection', g, tape)
        doubleNegatives.push(...ix.positive)
      }
    }
  }

  // Reverse a's CW negatives to CCW so addPolygonToRegion works correctly
  let unionedNegatives = a.negative.map((n) => reverseWinding(n, g))
  for (const bPos of b.positive) {
    const result = addPolygonToRegion(unionedNegatives, [], bPos, g, tape)
    unionedNegatives = result.positives
  }

  // Subtract each negative from a's positives
  let pos = a.positive
  const neg: PolygonVal[] = []
  for (const hole of unionedNegatives) {
    let escaped = false
    const nextPos: PolygonVal[] = []
    for (const p of pos) {
      const diff = booleanOperation(p, hole, 'difference', g, tape)
      if (diff.negative.length === 0) {
        escaped = true
        nextPos.push(...diff.positive)
      } else {
        nextPos.push(p)
      }
    }
    pos = nextPos
    if (!escaped) neg.push(hole)
  }

  return {
    type: 'region',
    positive: [...pos, ...doubleNegatives],
    negative: neg,
  }
}

/**
 * Intersect two regions.
 * Result = pairwise intersection of positives, minus all negatives from both.
 */
export function intersectRegions(
  a: RegionVal, b: RegionVal, g: LineageGraph, tape?: Tape | null,
): RegionVal {
  // Intersect each positive of a with each positive of b
  const intersected: PolygonVal[] = []
  for (const aPos of a.positive) {
    for (const bPos of b.positive) {
      const ix = booleanOperation(aPos, bPos, 'intersection', g, tape)
      intersected.push(...ix.positive)
    }
  }

  if (intersected.length === 0) return { type: 'region', positive: [], negative: [] }

  // Subtract all negatives from both regions (reverse CW->CCW first)
  let result: RegionVal = { type: 'region', positive: intersected, negative: [] }
  for (const neg of [...a.negative, ...b.negative]) {
    const negCCW = reverseWinding(neg, g)
    result = subtractRegions(result, asRegion(negCCW), g, tape)
  }

  return result
}
