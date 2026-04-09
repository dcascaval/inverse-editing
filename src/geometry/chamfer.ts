/**
 * Chamfer: cut corners of a polygon at specified vertices.
 *
 * For each target vertex, we offset along the two adjacent edges by the
 * chamfer radius and replace the vertex with two new points connected
 * by a straight chamfer edge.
 *
 * Based on ChamferAll / computeVertexTrim from the Scala reference.
 */

import type { NumericValue } from '@/lang/numeric'
import { real } from '@/lang/numeric'
import type { PolygonVal, Point2Val } from '@/lang/values'
import { createPoint, createPolygon } from '@/lang/values'
import type { LineageGraph } from '@/lang/lineage'


/**
 * Chamfer the specified vertices of a polygon.
 *
 * @param poly - Input polygon
 * @param vertices - Points to chamfer (matched by reference equality against poly.points)
 * @param radius - Chamfer distance along each edge from the vertex
 * @param g - Lineage graph for edge creation
 * @returns New polygon with chamfered corners
 */
export function chamferPolygon(
  poly: PolygonVal,
  vertices: Set<Point2Val>,
  radius: NumericValue,
  g: LineageGraph,
): PolygonVal {
  const r = radius.toNumber()
  if (r <= 1e-10) return poly

  const pts = poly.points
  const n = pts.length
  const result: Point2Val[] = []

  for (let i = 0; i < n; i++) {
    const pt = pts[i]
    if (!vertices.has(pt)) {
      result.push(pt)
      continue
    }

    // Adjacent edges: prev -> pt and pt -> next
    const prev = pts[(i - 1 + n) % n]
    const next = pts[(i + 1) % n]

    // Edge vectors
    const dxA = prev.x.sub(pt.x)
    const dyA = prev.y.sub(pt.y)
    const lenA = dxA.mul(dxA).add(dyA.mul(dyA)).sqrt()

    const dxB = next.x.sub(pt.x)
    const dyB = next.y.sub(pt.y)
    const lenB = dxB.mul(dxB).add(dyB.mul(dyB)).sqrt()

    // Offset point A: walk from pt toward prev by radius
    const tA = radius.div(lenA)
    const a = createPoint(
      pt.x.add(dxA.mul(tA)),
      pt.y.add(dyA.mul(tA)),
    )

    // Offset point B: walk from pt toward next by radius
    const tB = radius.div(lenB)
    const b = createPoint(
      pt.x.add(dxB.mul(tB)),
      pt.y.add(dyB.mul(tB)),
    )

    result.push(a, b)
  }

  return createPolygon(result, g)
}
