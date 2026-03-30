import * as THREE from 'three'
import type { Polygon2 } from '@/lang/interpreter'

/** Convert Polygon2 (with optional holes) to a THREE.Shape. */
export function polygonToShape(poly: Polygon2): THREE.Shape | null {
  const vs = poly.vertices
  if (vs.length < 3) return null
  const shape = new THREE.Shape()
  shape.moveTo(vs[0].x, vs[0].y)
  for (let i = 1; i < vs.length; i++) shape.lineTo(vs[i].x, vs[i].y)
  shape.closePath()
  if (poly.holes) {
    for (const hole of poly.holes) {
      if (hole.length < 3) continue
      const path = new THREE.Path()
      path.moveTo(hole[0].x, hole[0].y)
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y)
      path.closePath()
      shape.holes.push(path)
    }
  }
  return shape
}

/** Convert an array of Polygon2 to a single ShapeGeometry. */
export function polygonsToGeometry(polygons: Polygon2[]): THREE.ShapeGeometry | null {
  const shapes: THREE.Shape[] = []
  for (const poly of polygons) {
    const shape = polygonToShape(poly)
    if (shape) shapes.push(shape)
  }
  if (shapes.length === 0) return null
  return new THREE.ShapeGeometry(shapes)
}
