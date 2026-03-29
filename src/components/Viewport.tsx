import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useStore } from '@/store'

function SceneEdges() {
  const edges = useStore((s) => s.sceneEdges)

  const positions = useMemo(() => {
    const arr = new Float32Array(edges.length * 6)
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      const o = i * 6
      arr[o] = e.start.x
      arr[o + 1] = e.start.y
      arr[o + 2] = 0
      arr[o + 3] = e.end.x
      arr[o + 4] = e.end.y
      arr[o + 5] = 0
    }
    return arr
  }, [edges])

  if (edges.length === 0) return null

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#e4e4e7" />
    </lineSegments>
  )
}

function ScenePoints() {
  const points = useStore((s) => s.scenePoints)

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

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color="#a1a1aa" size={4} sizeAttenuation={false} />
    </points>
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
      <SceneEdges />
      <ScenePoints />
    </Canvas>
  )
}
