import { useMemo, useRef, useState, useCallback } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { MOUSE } from 'three'
import { Lock } from 'lucide-react'
import { useStore, type VertexLock } from '@/store'
import type { DrawBatch, AnnotatedEdge2 } from '@/lang/interpreter'
import { polygonsToGeometry, quads3ToGeometry, buildPlanarFaceMeshes } from '@/geometry/three'
import { findClosestEdge, buildDragSession, optimizeDrag, collectVertices, type DragSession } from '@/optimize/drag'
import { useSceneDragDrop } from '@/components/DragDrop'
import type { Point2 } from '@/lang/values'
import { DualValue } from '@/lang/grad'

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

function BatchFaces3({
  batch,
  onFaceDrag,
}: {
  batch: DrawBatch
  onFaceDrag?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { quads3, planarFaces3, style } = batch
  const quadGeo = useMemo(() => quads3ToGeometry(quads3), [quads3])
  const planarMeshes = useMemo(() => buildPlanarFaceMeshes(planarFaces3), [planarFaces3])
  if (!quadGeo && planarMeshes.length === 0) return null
  const fill = style.fill ?? '#e4e4e7'
  const opacity = (style.opacity ?? 1) * 0.35;

  const hoverHandlers = onFaceDrag ? {
    onPointerEnter: () => { document.body.style.cursor = 'grab' },
    onPointerLeave: () => { document.body.style.cursor = '' },
    onPointerDown: onFaceDrag,
  } : {}

  return (
    <>
      {quadGeo && (
        <mesh geometry={quadGeo} {...hoverHandlers}>
          <meshBasicMaterial color={fill} transparent depthWrite={false} opacity={opacity} side={THREE.DoubleSide} />
        </mesh>
      )}
      {planarMeshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} matrixAutoUpdate={false} matrix={m.matrix} {...hoverHandlers}>
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
          onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'grab' }}
          onPointerLeave={() => { setHovered(false); document.body.style.cursor = '' }}
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

function OptimizedDot({ position }: { position: Point2 }) {
  return (
    <mesh position={[position.x, position.y, 0.1]}>
      <circleGeometry args={[0.25, 16]} />
      <meshBasicMaterial color="#facc15" depthWrite={false} />
    </mesh>
  )
}

/** Invisible circular hit target at a vertex, with yellow hover. Alt+click toggles lock. */
function VertexHitbox({
  x, y, xIdx, yIdx, pt,
}: {
  x: number; y: number; xIdx: number; yIdx: number; pt: any
}) {
  const [hovered, setHovered] = useState(false)

  const handleClick = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!e.nativeEvent.altKey) return
    e.stopPropagation()

    const lineage = useStore.getState().lineage
    if (!lineage) return

    const rootIndices = lineage.findRootIndices(pt)
    if (rootIndices.size === 0) return

    const store = useStore.getState()
    // Toggle: if a lock with the same root indices exists, remove it
    const existing = store.locks.find((l) => {
      if (l.rootIndices.size !== rootIndices.size) return false
      for (const idx of rootIndices) {
        if (!l.rootIndices.has(idx)) return false
      }
      return true
    })

    if (existing) {
      store.removeLock(rootIndices)
    } else {
      store.addLock({ rootIndices, tapeXIdx: xIdx, tapeYIdx: yIdx, active: true })
    }
  }, [pt, xIdx, yIdx])

  return (
    <group>
      {/* Visible indicator on hover */}
      {hovered && (
        <mesh position={[x, y, 0.05]}>
          <ringGeometry args={[0.15, 0.25, 16]} />
          <meshBasicMaterial color={HOVER_COLOR} depthWrite={false} transparent opacity={0.8} />
        </mesh>
      )}
      {/* Invisible hit circle */}
      <mesh
        position={[x, y, 0.05]}
        visible={false}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={handleClick}
      >
        <circleGeometry args={[0.3, 16]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  )
}

/** Render lock icons at locked vertex positions. */
function LockIcons() {
  const locks = useStore((s) => s.locks)
  const tape = useStore((s) => s.tape)
  const dragActiveLockKeys = useStore((s) => s.dragActiveLockKeys)

  // Show a lock if:
  // - it's active, OR
  // - it went inert during drag but was active at drag start
  const lockPositions = useMemo(() => {
    if (!tape) return []
    return locks
      .filter((l) => {
        if (l.tapeXIdx >= tape.nodes.length || l.tapeYIdx >= tape.nodes.length) return false
        if (l.active) return true
        // Inert: only show if it was active at drag start
        const key = [...l.rootIndices].sort().join(',')
        return dragActiveLockKeys.has(key)
      })
      .map((l) => ({
        x: tape.nodes[l.tapeXIdx].primal,
        y: tape.nodes[l.tapeYIdx].primal,
        active: l.active,
      }))
  }, [locks, tape, dragActiveLockKeys])

  if (lockPositions.length === 0) return null

  const ACTIVE_COLOR = '#f97316'
  const INERT_COLOR = '#52525b'

  return (
    <>
      {lockPositions.map((pos, i) => {
        const color = pos.active ? ACTIVE_COLOR : INERT_COLOR
        return (
          <group key={i}>
            <mesh position={[pos.x, pos.y, 0.05]}>
              <circleGeometry args={[0.3, 16]} />
              <meshBasicMaterial color={color} depthWrite={false} />
            </mesh>
            <Html position={[pos.x + 0.6, pos.y + 0.6, 0]} style={{ pointerEvents: 'none' }}>
              <Lock size={12} color={color} strokeWidth={2.5} style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }} />
            </Html>
          </group>
        )
      })}
    </>
  )
}

/** Render invisible vertex hitboxes for alt+click locking. */
function VertexHitboxes() {
  const scene = useStore((s) => s.scene)

  const vertices = useMemo(() => {
    const allEdges = scene.flatMap((b) => b.edges)
    return collectVertices(allEdges)
  }, [scene])

  return (
    <>
      {vertices.map((v, i) => (
        <VertexHitbox
          key={i}
          x={v.x}
          y={v.y}
          xIdx={(v.pt.x as DualValue).index}
          yIdx={(v.pt.y as DualValue).index}
          pt={v.pt}
        />
      ))}
    </>
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
  setOptPoint: (p: Point2 | null) => void
}) {
  const scene = useStore((s) => s.scene)
  const sessionRef = useRef<DragSession | null>(null)
  const dragPlaneZRef = useRef(0)

  const { onDrag } = useSceneDragDrop(
    // onStart: find closest edge at intersection point, build session
    (worldPt, e) => {
      const tape = useStore.getState().tape
      if (!tape) return

      const allEdges = useStore.getState().scene.filter((b) => !b.style.dashed).flatMap((b) => b.edges)
      const pt = e.point
      // Set drag plane z from the 3D intersection (for vertical face drags)
      dragPlaneZRef.current = pt.z ?? 0
      const hit = findClosestEdge(allEdges, pt.x, pt.y)
      if (!hit) return

      e.stopPropagation()
      const session = buildDragSession(tape, hit.edge, hit.t, pt.x, pt.y, allEdges)
      sessionRef.current = session
      // Snapshot which locks are active at drag start
      const activeLockKeys = new Set<string>()
      for (const l of useStore.getState().locks) {
        if (l.active) activeLockKeys.add([...l.rootIndices].sort().join(','))
      }
      useStore.getState().setDragActiveLockKeys(activeLockKeys)
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
      useStore.getState().setDragActiveLockKeys(new Set())
    },
    dragPlaneZRef,
  )

  return (
    <>
      {scene.map((batch, i) => (
        <group key={i} renderOrder={i}>
          <BatchPolygons batch={batch} />
          <BatchFaces3 batch={batch} onFaceDrag={batch.style.dashed ? undefined : onDrag} />
          <BatchEdges batch={batch} onEdgeDrag={batch.style.dashed ? undefined : onDrag} />
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

function ClearLocksButton() {
  const locks = useStore((s) => s.locks)
  const clearLocks = useStore((s) => s.clearLocks)

  if (locks.length === 0) return null

  return (
    <button
      onClick={clearLocks}
      style={{
        position: 'absolute',
        top: 8,
        right: 52,
        zIndex: 10,
        padding: '4px 10px',
        background: '#27272a',
        color: '#f97316',
        border: '1px solid #3f3f46',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'monospace',
      }}
    >
      Clear Locks ({locks.length})
    </button>
  )
}

function HintText() {
  const scene = useStore((s) => s.scene)
  const hasEdges = scene.some((b) => b.edges.length > 0)
  if (!hasEdges) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        right: 12,
        zIndex: 10,
        color: '#52525b',
        fontSize: 11,
        fontFamily: 'monospace',
        lineHeight: 1.4,
        textAlign: 'right',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      drag edge to move | alt+click vertex to lock
    </div>
  )
}

export function Viewport() {
  const cameraMode = useStore((s) => s.cameraMode)
  const [optPoint, setOptPoint] = useState<{ x: number; y: number } | null>(null)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onContextMenu={(e) => e.preventDefault()}>
      <CameraModeButton />
      <ClearLocksButton />
      <HintText />
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
          <VertexHitboxes />
          <LockIcons />
          {optPoint && <OptimizedDot position={optPoint} />}
        </Canvas>
      ) : (
        <Canvas
          key="persp"
          frameloop='demand'
          camera={{ position: [60, 80, 60], up: [0, 0, 1], fov: 50, near: 0.1, far: 2000 }}
          style={{ background: '#18181b' }}
        >
          <OrbitControls
            target={[0, 0, 0]}
            makeDefault
            enableDamping={false}
            maxDistance={2000}
            zoomToCursor={true}
            mouseButtons={{
              LEFT: undefined,
              MIDDLE: undefined,
              RIGHT: MOUSE.ROTATE,
            }}
          />
          <DraggableBatches setOptPoint={setOptPoint} />
          <VertexHitboxes />
          <LockIcons />
          {optPoint && <OptimizedDot position={optPoint} />}
        </Canvas>
      )}
    </div>
  )
}
