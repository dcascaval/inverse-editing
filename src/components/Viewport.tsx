import { useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/store'
import type { DrawBatch } from '@/lang/interpreter'
import { polygonsToGeometry } from '@/geometry/three'

const DEFAULT_STROKE_COLOR = '#e4e4e7'
const DEFAULT_POINT_COLOR = '#a1a1aa'

function BatchPolygons({ batch }: { batch: DrawBatch }) {
  const { polygons, style } = batch

  const geometry = useMemo(() => polygonsToGeometry(polygons), [polygons])

  if (!geometry) return null

  const fill = style.fill ?? '#e4e4e7'

  const opacity = style.opacity ?? 1

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={fill}
        transparent
        depthWrite={false}
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
      lineWidth={1}
      transparent
      depthWrite={false}
      opacity={opacity}
      dashed={dashed}
      dashSize={1.0}
      gapSize={0.8}
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
        size={6}
        sizeAttenuation={false}
        transparent
        depthWrite={false}
        opacity={opacity}
      />
    </points>
  )
}

function CameraSetup() {
  const camera = useThree((s) => s.camera)
  useMemo(() => {
    camera.lookAt(30, 30, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

function Scene() {
  const scene = useStore((s) => s.scene)

  return (
    <>
      <CameraSetup />
      {scene.map((batch, i) => (
        <group key={i} renderOrder={i}>
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
      frameloop='demand'
      orthographic
      camera={{ position: [30, 30, 100], zoom: 8, near: 0.1, far: 1000 }}
      style={{ background: '#18181b' }}
    >
      <Scene />
    </Canvas>
  )
}
