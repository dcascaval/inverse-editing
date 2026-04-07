import * as THREE from 'three'
import type { Polygon2, Quad3, PlanarFaceDraw } from '@/lang/interpreter'

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


// ── 3D face geometry ──


/** Build a BufferGeometry from an array of 3D quads (2 triangles each). */
export function quads3ToGeometry(quads: Quad3[]): THREE.BufferGeometry | null {
  if (quads.length === 0) return null
  const arr = new Float32Array(quads.length * 18)
  let offset = 0
  for (const [a, b, c, d] of quads) {
    arr[offset++] = a.x; arr[offset++] = a.y; arr[offset++] = a.z
    arr[offset++] = b.x; arr[offset++] = b.y; arr[offset++] = b.z
    arr[offset++] = c.x; arr[offset++] = c.y; arr[offset++] = c.z
    arr[offset++] = a.x; arr[offset++] = a.y; arr[offset++] = a.z
    arr[offset++] = c.x; arr[offset++] = c.y; arr[offset++] = c.z
    arr[offset++] = d.x; arr[offset++] = d.y; arr[offset++] = d.z
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * Build {geometry, matrix} pairs for planar face draws.
 * Each face is tessellated in 2D via ShapeGeometry, then placed in 3D by its matrix.
 */
export function buildPlanarFaceMeshes(faces: PlanarFaceDraw[]): { geometry: THREE.ShapeGeometry; matrix: THREE.Matrix4 }[] {
  const result: { geometry: THREE.ShapeGeometry; matrix: THREE.Matrix4 }[] = []
  for (const face of faces) {
    const shape = polygonToShape(face.polygon)
    if (!shape) continue
    result.push({ geometry: new THREE.ShapeGeometry(shape), matrix: face.matrix })
  }
  return result
}
