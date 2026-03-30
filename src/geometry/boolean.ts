import {
  type Value,
  type Point2Val,
  type Edge2Val,
  type PolygonVal,
  type RegionVal,
  createPoint,
  createPolygon,
} from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'
import { pointInPolygon } from '@/geometry/polygon'


// ---- Constants ----


const EPS = 1e-10
const SNAP = 1e-9
const MATCH_EPS = 1e-6
const SEG_TOL = 1e-6
const SEG_TOL_SQ = SEG_TOL * SEG_TOL


// ---- Internal types ----


type Vec2 = { x: number; y: number }

type VertexOrigin = {
  sourcePoints: Point2Val[]
  sourceEdges: Edge2Val[]
}

type Vertex = Vec2 & {
  id: number
  origin: VertexOrigin
}

type SubEdge = {
  startId: number
  endId: number
  srcEdge: Edge2Val
  srcPoly: 0 | 1
}


// ---- Vertex pool ----


class VertexPool {
  private verts: Vertex[] = []

  getOrCreate(x: number, y: number): Vertex {
    const sx = Math.round(x / SNAP) * SNAP
    const sy = Math.round(y / SNAP) * SNAP
    for (const v of this.verts) {
      if (Math.abs(v.x - sx) < MATCH_EPS && Math.abs(v.y - sy) < MATCH_EPS) return v
    }
    const v: Vertex = {
      x: sx, y: sy, id: this.verts.length,
      origin: { sourcePoints: [], sourceEdges: [] },
    }
    this.verts.push(v)
    return v
  }

  get(id: number): Vertex { return this.verts[id] }
}


// ---- Geometry utilities ----


function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Parameter t such that projection of pt onto line a→b is a + t*(b-a). */
function closestParameter(a: Vec2, b: Vec2, pt: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < EPS * EPS) return 0
  return ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2
}

function signedArea2(pts: Vec2[]): number {
  let sum = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return sum
}

/** Check if polygon `outer` fully contains polygon `inner`. */
function polyContainsPoly(outer: Vec2[], inner: Vec2[]): boolean {
  return pointInPolygon(inner[0], outer) && pointInPolygon(inner[1], outer)
}


// ---- Segment-segment intersection (matching segmentSegmentBoolean) ----


type Intersection = {
  x: number
  y: number
  tA: number
  tB: number
}

/**
 * Find intersections between two segments. Returns 0..4 results.
 *
 * For non-parallel segments: standard parametric intersection (0 or 1 result).
 * For collinear/parallel segments: tests all 4 endpoints against the other
 * segment, returning the overlap boundary points (0..4 results).
 *
 * This matches the reference `segmentSegmentBoolean` function.
 */
function segSegIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Intersection[] {
  const dax = a2.x - a1.x, day = a2.y - a1.y
  const dbx = b2.x - b1.x, dby = b2.y - b1.y
  const cross = dax * dby - day * dbx

  const lenA = Math.sqrt(dax * dax + day * day)
  const lenB = Math.sqrt(dbx * dbx + dby * dby)
  if (lenA < EPS || lenB < EPS) return []

  const crossNorm = Math.abs(cross) / (lenA * lenB)

  // ---- Collinear / parallel case ----
  if (crossNorm < Math.sqrt(SEG_TOL)) {
    const result: Intersection[] = []

    function addIntervalPoint(
      segStart: Vec2, segEnd: Vec2, pt: Vec2,
      isFromA: boolean, isEnd: boolean,
    ) {
      const t = closestParameter(segStart, segEnd, pt)
      const proj = {
        x: segStart.x + t * (segEnd.x - segStart.x),
        y: segStart.y + t * (segEnd.y - segStart.y),
      }
      if (dist2(proj, pt) > SEG_TOL_SQ) return // pt not on this line
      const constParam = isEnd ? 1.0 : 0.0
      const tA = isFromA ? constParam : t
      const tB = isFromA ? t : constParam
      if (tA >= -SEG_TOL && tA <= 1 + SEG_TOL && tB >= -SEG_TOL && tB <= 1 + SEG_TOL) {
        result.push({
          x: pt.x, y: pt.y,
          tA: Math.max(0, Math.min(1, tA)),
          tB: Math.max(0, Math.min(1, tB)),
        })
      }
    }

    // Test each of the 4 endpoints against the other segment
    addIntervalPoint(b1, b2, a1, true, false)   // a1 on B → tA=0
    addIntervalPoint(b1, b2, a2, true, true)     // a2 on B → tA=1
    addIntervalPoint(a1, a2, b1, false, false)   // b1 on A → tB=0
    addIntervalPoint(a1, a2, b2, false, true)    // b2 on A → tB=1

    return result
  }

  // ---- Non-parallel case ----
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / cross
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / cross
  if (t < -SEG_TOL || t > 1 + SEG_TOL || u < -SEG_TOL || u > 1 + SEG_TOL) return []
  const tc = Math.max(0, Math.min(1, t))
  const uc = Math.max(0, Math.min(1, u))
  return [{
    x: a1.x + tc * dax,
    y: a1.y + tc * day,
    tA: tc,
    tB: uc,
  }]
}


// ---- Edge shattering ----


type ShatterResult = {
  subEdges: SubEdge[]
  foundIntersections: boolean
}

function shatterPolygon(
  pts: Vec2[], edges: Edge2Val[], polyId: 0 | 1,
  otherPts: Vec2[], otherEdges: Edge2Val[],
  pool: VertexPool,
): ShatterResult {
  const n = pts.length
  const result: SubEdge[] = []
  let foundIntersections = false

  for (let i = 0; i < n; i++) {
    const p0 = pts[i]
    const p1 = pts[(i + 1) % n]
    const srcEdge = edges[i]

    // Find all intersection parameters along this edge
    const splits: { t: number; vertex: Vertex }[] = []

    const m = otherPts.length
    for (let j = 0; j < m; j++) {
      const q0 = otherPts[j]
      const q1 = otherPts[(j + 1) % m]
      const ixs = segSegIntersect(p0, p1, q0, q1)

      for (const ix of ixs) {
        foundIntersections = true

        // Only split if intersection is in the interior of THIS edge
        if (ix.tA < EPS || ix.tA > 1 - EPS) continue

        const v = pool.getOrCreate(ix.x, ix.y)
        v.origin.sourceEdges.push(srcEdge, otherEdges[j])
        splits.push({ t: ix.tA, vertex: v })
      }
    }

    // Sort by parameter and deduplicate
    splits.sort((a, b) => a.t - b.t)
    const unique: typeof splits = []
    for (const s of splits) {
      if (unique.length > 0 && unique[unique.length - 1].vertex.id === s.vertex.id) continue
      unique.push(s)
    }

    // Build sub-edges
    const startV = pool.getOrCreate(p0.x, p0.y)
    const endV = pool.getOrCreate(p1.x, p1.y)

    if (unique.length === 0) {
      result.push({ startId: startV.id, endId: endV.id, srcEdge, srcPoly: polyId })
    } else {
      let prevId = startV.id
      for (const s of unique) {
        result.push({ startId: prevId, endId: s.vertex.id, srcEdge, srcPoly: polyId })
        prevId = s.vertex.id
      }
      result.push({ startId: prevId, endId: endV.id, srcEdge, srcPoly: polyId })
    }
  }

  return { subEdges: result, foundIntersections }
}


// ---- Edge deduplication (matching reference merge* pattern) ----
//
// Process all sub-edges one at a time. When an equal or reverse edge is found
// in the accumulator, handle it per the operation rules. Edges that survive
// dedup as "edgesOnBoth" bypass the containment filter entirely — this is
// critical because their midpoints sit on the other polygon's boundary.


function deduplicateAndFilter(
  subEdgesA: SubEdge[], subEdgesB: SubEdge[],
  pool: VertexPool,
  polyA: Vec2[], polyB: Vec2[],
  op: BooleanOp,
): SubEdge[] {
  const edgesOnBoth: SubEdge[] = []
  let allEdges: SubEdge[] = []

  function insert(edge: SubEdge) {
    // Check for equal edge (same start, same end)
    const eqIdx = allEdges.findIndex((e) =>
      e.startId === edge.startId && e.endId === edge.endId)
    if (eqIdx >= 0) {
      const matched = allEdges[eqIdx]
      allEdges.splice(eqIdx, 1)
      switch (op) {
        case 'union':        edgesOnBoth.push(matched); return  // keep one
        case 'intersection': edgesOnBoth.push(matched); return  // keep one
        case 'difference':   return                             // discard both
      }
    }

    // Check for reverse edge (start↔end swapped)
    const revIdx = allEdges.findIndex((e) =>
      e.startId === edge.endId && e.endId === edge.startId)
    if (revIdx >= 0) {
      const matched = allEdges[revIdx]
      allEdges.splice(revIdx, 1)
      switch (op) {
        case 'union':        return                             // discard both
        case 'intersection': return                             // discard both
        case 'difference':   edgesOnBoth.push(matched); return  // keep one
      }
    }

    allEdges.push(edge)
  }

  for (const e of subEdgesA) insert(e)
  for (const e of subEdgesB) insert(e)

  // Filter remaining edges by midpoint containment
  const filtered: SubEdge[] = []
  for (const e of allEdges) {
    const s = pool.get(e.startId)
    const t = pool.get(e.endId)
    const mid: Vec2 = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }

    let keep: boolean
    if (e.srcPoly === 0) {
      const inB = pointInPolygon(mid, polyB)
      keep = (op === 'intersection') ? inB : !inB
    } else {
      const inA = pointInPolygon(mid, polyA)
      keep = (op === 'union') ? !inA : inA
    }

    if (keep) filtered.push(e)
  }

  // Re-add edges that were on both polygons (they skip containment)
  filtered.push(...edgesOnBoth)

  // For difference: flip all B edges
  return filtered.map((e) => {
    if (op === 'difference' && e.srcPoly === 1) {
      return { startId: e.endId, endId: e.startId, srcEdge: e.srcEdge, srcPoly: e.srcPoly }
    }
    return e
  })
}


// ---- Graph reconstruction ----
//
// Walk directed edges to extract closed polygon loops. At each vertex,
// pick the outgoing edge using the "highest angle < incoming reverse"
// rule (matching the reference `reconstructRegion`).


type Loop = {
  vertexIds: number[]
  subEdges: SubEdge[]
}

function reconstructLoops(edges: SubEdge[], pool: VertexPool): Loop[] {
  if (edges.length === 0) return []

  // Build adjacency: vertex → outgoing edges with angles
  // Angle uses +π offset to match reference convention
  const adj = new Map<number, { endId: number; idx: number; angle: number }[]>()
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    const s = pool.get(e.startId)
    const t = pool.get(e.endId)
    const angle = Math.atan2(t.y - s.y, t.x - s.x) + Math.PI
    let list = adj.get(e.startId)
    if (!list) { list = []; adj.set(e.startId, list) }
    list.push({ endId: e.endId, idx: i, angle })
  }

  for (const list of adj.values()) {
    list.sort((a, b) => a.angle - b.angle)
  }

  const unvisited = new Set<number>()
  for (let i = 0; i < edges.length; i++) unvisited.add(i)

  const loops: Loop[] = []

  while (unvisited.size > 0) {
    // Prefer starting from an edge with a single outgoing at its start
    let startIdx: number | undefined
    for (const idx of unvisited) {
      const outgoing = adj.get(edges[idx].startId)
      const liveCount = outgoing ? outgoing.filter((e) => unvisited.has(e.idx)).length : 0
      if (liveCount === 1) { startIdx = idx; break }
    }
    if (startIdx === undefined) {
      startIdx = unvisited.values().next().value!
    }

    const loop: Loop = { vertexIds: [], subEdges: [] }
    let currentIdx = startIdx
    const startVertexId = edges[startIdx].startId

    while (true) {
      unvisited.delete(currentIdx)
      const e = edges[currentIdx]
      loop.vertexIds.push(e.startId)
      loop.subEdges.push(e)

      // Closed?
      if (e.endId === startVertexId) break

      // Find next edge
      const outgoing = adj.get(e.endId)
      if (!outgoing) break

      const incomingAngle = (
        Math.atan2(
          pool.get(e.startId).y - pool.get(e.endId).y,
          pool.get(e.startId).x - pool.get(e.endId).x,
        ) + Math.PI
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

    // Accept only closed loops with ≥3 vertices
    if (loop.vertexIds.length >= 3 &&
        loop.subEdges[loop.subEdges.length - 1].endId === startVertexId) {
      loops.push(loop)
    }
  }

  return loops
}


// ---- Collinear merging ----


function isCollinear(pool: VertexPool, a: SubEdge, b: SubEdge): boolean {
  const a0 = pool.get(a.startId), a1 = pool.get(a.endId)
  const b0 = pool.get(b.startId), b1 = pool.get(b.endId)
  const dax = a1.x - a0.x, day = a1.y - a0.y
  const dbx = b1.x - b0.x, dby = b1.y - b0.y
  return Math.abs(dax * dby - day * dbx) < EPS
}

function mergeCollinearEdges(loop: Loop, pool: VertexPool): Loop {
  if (loop.vertexIds.length <= 3) return loop

  const n = loop.vertexIds.length
  const merged: { vertexId: number; subEdge: SubEdge; mergedFrom: SubEdge[] }[] = []

  for (let i = 0; i < n; i++) {
    const e = loop.subEdges[i]
    if (merged.length > 0 && isCollinear(pool, merged[merged.length - 1].subEdge, e)) {
      const prev = merged[merged.length - 1]
      prev.subEdge = { ...prev.subEdge, endId: e.endId }
      prev.mergedFrom.push(e)
    } else {
      merged.push({ vertexId: loop.vertexIds[i], subEdge: e, mergedFrom: [e] })
    }
  }

  // Wrap-around: check if last and first are collinear
  if (merged.length > 1 && isCollinear(pool, merged[merged.length - 1].subEdge, merged[0].subEdge)) {
    const last = merged.pop()!
    merged[0].subEdge = { ...merged[0].subEdge, startId: last.subEdge.startId }
    merged[0].vertexId = last.vertexId
    merged[0].mergedFrom = [...last.mergedFrom, ...merged[0].mergedFrom]
  }

  return {
    vertexIds: merged.map((m) => m.vertexId),
    subEdges: merged.map((m) => m.subEdge),
  }
}


// ---- Output construction with lineage ----


function buildOutputPolygon(
  loop: Loop, preMergeEdges: SubEdge[],
  pool: VertexPool, g: LineageGraph,
): PolygonVal {
  const points: Point2Val[] = loop.vertexIds.map((vid) => {
    const v = pool.get(vid)
    const pt = createPoint(v.x, v.y)
    for (const sp of v.origin.sourcePoints) g.direct(sp, pt)
    for (const se of v.origin.sourceEdges) g.direct(se, pt)
    return pt
  })

  const poly = createPolygon(points, g)

  // Direct lineage: source edge → output edge
  for (let i = 0; i < loop.subEdges.length; i++) {
    g.direct(loop.subEdges[i].srcEdge, poly.edges[i])
  }

  return poly
}


// ---- Extract polygon data from Value ----


function extractPoly(v: Value): { pts: Vec2[]; points: Point2Val[]; edges: Edge2Val[] } {
  switch (v.type) {
    case 'rectangle':
    case 'polygon':
      return {
        pts: v.points.map((p) => ({ x: p.x, y: p.y })),
        points: v.points,
        edges: v.edges,
      }
    default:
      throw new Error(`Cannot use ${v.type} in boolean operation`)
  }
}


// ---- Public API ----


export type BooleanOp = 'union' | 'difference' | 'intersection'

export function booleanOperation(
  a: Value, b: Value, op: BooleanOp, g: LineageGraph,
): RegionVal {
  const polyA = extractPoly(a)
  const polyB = extractPoly(b)
  const pool = new VertexPool()

  // Seed vertex pool with original polygon vertices
  for (const pt of polyA.points) {
    pool.getOrCreate(pt.x, pt.y).origin.sourcePoints.push(pt)
  }
  for (const pt of polyB.points) {
    pool.getOrCreate(pt.x, pt.y).origin.sourcePoints.push(pt)
  }

  // Shatter both polygons at intersection points
  const resultA = shatterPolygon(
    polyA.pts, polyA.edges, 0,
    polyB.pts, polyB.edges, pool,
  )
  const resultB = shatterPolygon(
    polyB.pts, polyB.edges, 1,
    polyA.pts, polyA.edges, pool,
  )

  // The collinear-aware segSegIntersect detects ANY touching between
  // polygons (including shared edges, shared vertices). If nothing was
  // found, the polygons are fully separated or one contains the other.
  const hasIntersections = resultA.foundIntersections || resultB.foundIntersections

  if (!hasIntersections) {
    const aInB = polyContainsPoly(polyB.pts, polyA.pts)
    const bInA = polyContainsPoly(polyA.pts, polyB.pts)

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

  // Full boolean pipeline: dedup + filter + reconstruct
  const finalEdges = deduplicateAndFilter(
    resultA.subEdges, resultB.subEdges, pool, polyA.pts, polyB.pts, op,
  )

  const loops = reconstructLoops(finalEdges, pool)

  const positive: PolygonVal[] = []
  const negative: PolygonVal[] = []

  for (const loop of loops) {
    const preMerge = [...loop.subEdges]
    const merged = mergeCollinearEdges(loop, pool)
    const poly = buildOutputPolygon(merged, preMerge, pool, g)

    const verts = merged.vertexIds.map((id) => pool.get(id))
    const area = signedArea2(verts)
    if (area > EPS) positive.push(poly)
    else if (area < -EPS) negative.push(poly)
  }

  return { type: 'region', positive, negative }
}


// ---- Early-return helpers ----


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
  // Reverse points for CW winding (hole)
  const reversed = [...pts].reverse()
  const holePoly = createPolygon(reversed, g)
  for (let i = 0; i < h.edges.length; i++) g.direct(h.edges[i], holePoly.edges[i])
  return {
    type: 'region',
    positive: outerRegion.positive,
    negative: [holePoly],
  }
}
