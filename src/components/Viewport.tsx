import { useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { MOUSE } from 'three'
import { useStore } from '@/store'
import type { DrawBatch } from '@/lang/interpreter'
import { polygonsToGeometry, quads3ToGeometry, buildPlanarFaceMeshes } from '@/geometry/three'
import { findClosestEdge, buildDragSession, optimizeDrag, type DragSession } from '@/optimize/drag'
import { useSceneDragDrop2D } from '@/components/DragDrop'

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

const HOVER_COLOR = '#facc15'
const HIT_LINE_WIDTH = 12

function BatchEdges({
  batch,
  onEdgeDrag,
}: {
  batch: DrawBatch
  onEdgeDrag?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { edges, style } = batch
  const [hovered, setHovered] = useState(false)

  const points = useMemo(
    () =>
      edges.flatMap((e) => [
        [e.start.x, e.start.y, (e.start as any).z ?? 0] as [number, number, number],
        [e.end.x, e.end.y, (e.end as any).z ?? 0] as [number, number, number],
      ]),
    [edges],
  )

  if (points.length === 0) return null

  const baseColor = style.stroke ?? DEFAULT_STROKE_COLOR
  const color = hovered ? HOVER_COLOR : baseColor
  const opacity = style.opacity ?? 1
  const dashed = style.dashed ?? false

  return (
    <group>
      {/* Visible line */}
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
      {/* Invisible wider line for hit-testing */}
      {onEdgeDrag && (
        <Line
          points={points}
          segments
          lineWidth={HIT_LINE_WIDTH}
          visible={false}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onPointerDown={onEdgeDrag}
        />
      )}
    </group>
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

function OptimizedDot({ position }: { position: { x: number; y: number } }) {
  return (
    <mesh position={[position.x, position.y, 0.1]}>
      <circleGeometry args={[0.5, 16]} />
      <meshBasicMaterial color="#facc15" depthWrite={false} />
    </mesh>
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

function DraggableBatches({
  setOptPoint,
}: {
  setOptPoint: (p: { x: number; y: number } | null) => void
}) {
  const scene = useStore((s) => s.scene)
  const sessionRef = useRef<DragSession | null>(null)

  const { onDrag } = useSceneDragDrop2D(
    // onStart: find closest edge at intersection point, build session
    (worldPt, e) => {
      const tape = useStore.getState().tape
      if (!tape) return

      const allEdges = useStore.getState().scene.flatMap((b) => b.edges)
      const pt = e.point
      const hit = findClosestEdge(allEdges, pt.x, pt.y)
      if (!hit) return

      e.stopPropagation()
      const session = buildDragSession(tape, hit.edge, hit.t, pt.x, pt.y, allEdges)
      sessionRef.current = session
    },
    // onUpdate: optimize toward drag target
    async (worldPt) => {
      const session = sessionRef.current
      if (!session) return
      const pt = await optimizeDrag(session, worldPt[0], worldPt[1])
      setOptPoint(pt)
    },
    // onComplete: clean up
    () => {
      sessionRef.current = null
      setOptPoint(null)
    },
  )

  return (
    <>
      {scene.map((batch, i) => (
        <group key={i} renderOrder={i}>
          <BatchPolygons batch={batch} />
          <BatchFaces3 batch={batch} />
          <BatchEdges batch={batch} onEdgeDrag={onDrag} />
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

export function Viewport() {
  const cameraMode = useStore((s) => s.cameraMode)
  const [optPoint, setOptPoint] = useState<{ x: number; y: number } | null>(null)

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
          <OrbitControls
            enableDamping={false}
            enableRotate={false}
            makeDefault
            maxDistance={1000}
            zoomSpeed={1.5}
            minZoom={0.5}
            zoomToCursor={true}
            mouseButtons={{
              LEFT: undefined,
              MIDDLE: undefined,
              RIGHT: MOUSE.PAN,
            }}
          />
          <DraggableBatches setOptPoint={setOptPoint} />
          {optPoint && <OptimizedDot position={optPoint} />}
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
