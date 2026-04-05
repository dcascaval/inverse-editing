import type { Point2 } from '@/lang/values'
import type { Polygon2 } from '@/lang/interpreter'
import type { RegionVal } from '@/lang/values'

export function pointInPolygon(pt: Point2, poly: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y, yj = poly[j].y
    if ((yi > pt.y) !== (yj > pt.y)) {
      const x = (poly[j].x - poly[i].x) * (pt.y - yi) / (yj - yi) + poly[i].x
      if (pt.x < x) inside = !inside
    }
  }
  return inside
}

/** Distribute negative polygons as holes into their containing positive polygons. */
export function distributeHoles(region: RegionVal): Polygon2[] {
  const positives: Polygon2[] = region.positive.map((p) => ({
    vertices: p.points.map((v) => ({ x: v.x.toNumber(), y: v.y.toNumber() })),
    holes: [],
  }))
  for (const neg of region.negative) {
    const holeVerts = neg.points.map((v) => ({ x: v.x.toNumber(), y: v.y.toNumber() }))
    const testPt = holeVerts[0]
    for (const pos of positives) {
      if (pointInPolygon(testPt, pos.vertices)) {
        pos.holes!.push(holeVerts)
        break
      }
    }
  }
  return positives
}
