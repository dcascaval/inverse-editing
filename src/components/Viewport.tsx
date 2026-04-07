import { useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/store'
import type { DrawBatch } from '@/lang/interpreter'
import { polygonsToGeometry, quads3ToGeometry, buildPlanarFaceMeshes } from '@/geometry/three'

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

function BatchFaces3({ batch }: { batch: DrawBatch }) {
  const { quads3, planarFaces3, style } = batch

  const quadGeo = useMemo(() => quads3ToGeometry(quads3), [quads3])
  const planarMeshes = useMemo(() => buildPlanarFaceMeshes(planarFaces3), [planarFaces3])

  if (!quadGeo && planarMeshes.length === 0) return null

  const fill = style.fill ?? '#e4e4e7'
  const opacity = (style.opacity ?? 1) * 0.35;

  return (
    <>
      {quadGeo && (
        <mesh geometry={quadGeo}>
          <meshBasicMaterial color={fill} transparent depthWrite={false} opacity={opacity} side={THREE.DoubleSide} />
        </mesh>
      )}
      {planarMeshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} matrixAutoUpdate={false} matrix={m.matrix}>
          <meshBasicMaterial color={fill} transparent depthWrite={false} opacity={opacity} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  )
}

function BatchEdges({ batch }: { batch: DrawBatch }) {
  const { edges, style } = batch

  const points = useMemo(
    () =>
      edges.flatMap((e) => [
        [e.start.x, e.start.y, (e.start as any).z ?? 0] as [number, number, number],
        [e.end.x, e.end.y, (e.end as any).z ?? 0] as [number, number, number],
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
      polygonOffset
      polygonOffsetFactor={-1}
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
      arr[i * 3 + 2] = (points[i] as any).z ?? 0
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

function CameraSetup2D() {
  const camera = useThree((s) => s.camera)
  useMemo(() => {
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

function Batches() {
  const scene = useStore((s) => s.scene)

  return (
    <>
      {scene.map((batch, i) => (
        <group key={i} renderOrder={i}>
          <BatchPolygons batch={batch} />
          <BatchFaces3 batch={batch} />
          <BatchEdges batch={batch} />
          <BatchPoints batch={batch} />
        </group>
      ))}
    </>
  )
}

function CameraModeButton() {
  const cameraMode = useStore((s) => s.cameraMode)
  const setCameraMode = useStore((s) => s.setCameraMode)

  return (
    <button
      onClick={() => setCameraMode(cameraMode === '2d' ? '3d' : '2d')}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        padding: '4px 10px',
        background: '#27272a',
        color: '#e4e4e7',
        border: '1px solid #3f3f46',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'monospace',
      }}
    >
      {cameraMode === '2d' ? '2D' : '3D'}
    </button>
  )
}

export function Viewport() {
  const cameraMode = useStore((s) => s.cameraMode)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onContextMenu={(e) => e.preventDefault()}>
      <CameraModeButton />
      {cameraMode === '2d' ? (
        <Canvas
          key="ortho"
          frameloop='demand'
          orthographic
          camera={{ position: [0, 0, 100], zoom: 8, near: 0.1, far: 1000 }}
          style={{ background: '#18181b' }}
        >
          <CameraSetup2D />
          <Batches />
        </Canvas>
      ) : (
        <Canvas
          key="persp"
          frameloop='demand'
          camera={{ position: [60, 80, 60], up: [0, 0, 1], fov: 50, near: 0.1, far: 2000 }}
          style={{ background: '#18181b' }}
        >
          <OrbitControls target={[0, 0, 0]} makeDefault enableDamping={false} />
          <Batches />
        </Canvas>
      )}
    </div>
  )
}
