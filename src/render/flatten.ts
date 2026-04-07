/**
 * Flatten DrawBatch[] into GPU-ready triangle and segment arrays.
 * Uses Three.js to triangulate polygons (via ShapeGeometry) so we never
 * have to deal with holes ourselves.
 */
import * as THREE from 'three'
import type { DrawBatch, DrawStyle } from '@/lang/interpreter'
import type { GPUTriangle, GPUSegment } from '@/render/types'
import { polygonsToGeometry, quads3ToGeometry, buildPlanarFaceMeshes } from '@/geometry/three'

const _tmpColor = new THREE.Color()
function parseColor(color: string | undefined, fallback: string): [number, number, number] {
  // Parse with Three.js for broad CSS color format support.
  // Convert back to sRGB since our shader writes directly to display (rgba8unorm).
  _tmpColor.set(color ?? fallback)
  if (THREE.ColorManagement.enabled) _tmpColor.convertLinearToSRGB()
  return [_tmpColor.r, _tmpColor.g, _tmpColor.b]
}

function extractTrianglesFromGeometry(
  geo: THREE.BufferGeometry,
  color: [number, number, number, number],
  matrix?: THREE.Matrix4,
): GPUTriangle[] {
  const tris: GPUTriangle[] = []
  const pos = geo.getAttribute('position')
  if (!pos) return tris
  const index = geo.getIndex()

  const v = new THREE.Vector3()
  function getVertex(i: number): [number, number, number] {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    if (matrix) v.applyMatrix4(matrix)
    return [v.x, v.y, v.z]
  }

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      tris.push({
        v0: getVertex(index.getX(i)),
        v1: getVertex(index.getX(i + 1)),
        v2: getVertex(index.getX(i + 2)),
        color,
      })
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      tris.push({
        v0: getVertex(i),
        v1: getVertex(i + 1),
        v2: getVertex(i + 2),
        color,
      })
    }
  }
  return tris
}

export function flattenBatches(batches: DrawBatch[]): {
  triangles: GPUTriangle[]
  segments: GPUSegment[]
} {
  const triangles: GPUTriangle[] = []
  const segments: GPUSegment[] = []

  for (const batch of batches) {
    const { style } = batch
    const fillRGB = parseColor(style.fill, '#e4e4e7')
    const strokeRGB = parseColor(style.stroke ?? style.fill, '#e4e4e7')
    const opacity = style.opacity ?? 1

    // 2D polygons (triangulated by Three.js ShapeGeometry)
    const polyGeo = polygonsToGeometry(batch.polygons)
    if (polyGeo) {
      const color: [number, number, number, number] = [...fillRGB, opacity]
      triangles.push(...extractTrianglesFromGeometry(polyGeo, color))
      polyGeo.dispose()
    }

    // 3D quads
    const quadGeo = quads3ToGeometry(batch.quads3)
    if (quadGeo) {
      const color: [number, number, number, number] = [...fillRGB, opacity * 0.35]
      triangles.push(...extractTrianglesFromGeometry(quadGeo, color))
      quadGeo.dispose()
    }

    // Planar 3D faces
    const planarMeshes = buildPlanarFaceMeshes(batch.planarFaces3)
    for (const m of planarMeshes) {
      const color: [number, number, number, number] = [...fillRGB, opacity * 0.35]
      triangles.push(...extractTrianglesFromGeometry(m.geometry, color, m.matrix))
      m.geometry.dispose()
    }

    // Edges → line segments
    for (const e of batch.edges) {
      segments.push({
        p0: [e.start.x, e.start.y, (e.start as any).z ?? 0],
        p1: [e.end.x, e.end.y, (e.end as any).z ?? 0],
        color: [...strokeRGB, opacity],
        radius: 0.04, // world-space half-width
      })
    }
  }

  return { triangles, segments }
}
