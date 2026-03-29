import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/store'
import type { DrawBatch } from '@/lang/interpreter'

const DEFAULT_STROKE_COLOR = '#e4e4e7'
const DEFAULT_POINT_COLOR = '#a1a1aa'

function BatchPolygons({ batch }: { batch: DrawBatch }) {
  const { polygons, style } = batch

  const geometry = useMemo(() => {
    if (polygons.length === 0) return null
    const geo = new THREE.BufferGeometry()
    const verts: number[] = []
    // Triangulate each polygon as a fan from its first vertex
    for (const poly of polygons) {
      const vs = poly.vertices
      for (let i = 1; i < vs.length - 1; i++) {
        verts.push(vs[0].x, vs[0].y, 0)
        verts.push(vs[i].x, vs[i].y, 0)
        verts.push(vs[i + 1].x, vs[i + 1].y, 0)
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return geo
  }, [polygons])

  if (!geometry || !style.fill) return null

  const opacity = style.opacity ?? 1

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={style.fill}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function BatchEdges({ batch }: { batch: DrawBatch }) {
  const { edges, style } = batch

  const points = useMemo(
    () =>
      edges.flatMap((e) => [
        [e.start.x, e.start.y, 0] as [number, number, number],
        [e.end.x, e.end.y, 0] as [number, number, number],
      ]),
    [edges],
  )

  if (points.length === 0) return null

  const color = style.stroke ?? DEFAULT_STROKE_COLOR
  const opacity = style.opacity ?? 1
  const dashed = style.dashed ?? false

  return (
    <Line
      points={points}
      segments
      color={color}
      lineWidth={2}
      transparent={opacity < 1}
      opacity={opacity}
      dashed={dashed}
      dashSize={0.5}
      gapSize={0.3}
    />
  )
}

function BatchPoints({ batch }: { batch: DrawBatch }) {
  const { points, style } = batch

  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      arr[i * 3] = points[i].x
      arr[i * 3 + 1] = points[i].y
      arr[i * 3 + 2] = 0
    }
    return arr
  }, [points])

  if (points.length === 0) return null

  const color = style.fill ?? DEFAULT_POINT_COLOR
  const opacity = style.opacity ?? 1

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={4}
        sizeAttenuation={false}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </points>
  )
}

function Scene() {
  const scene = useStore((s) => s.scene)

  return (
    <>
      {scene.map((batch, i) => (
        <group key={i}>
          <BatchPolygons batch={batch} />
          <BatchEdges batch={batch} />
          <BatchPoints batch={batch} />
        </group>
      ))}
    </>
  )
}

export function Viewport() {
  return (
    <Canvas
      orthographic
      flat
      gl={{ antialias: false, alpha: false }}
      camera={{ position: [0, 0, 100], zoom: 10, near: 0.1, far: 1000 }}
      style={{ background: '#18181b' }}
    >
      <Scene />
    </Canvas>
  )
}
