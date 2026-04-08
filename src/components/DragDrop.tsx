/**
 * Drag-drop hooks for R3F, ported from Concept/Frontend/src/Common/DragDrop.tsx.
 *
 * useScreenDragDrop: manages screen-space drag lifecycle (down → move → up),
 * handles debouncing, Escape cancellation, and cleanup.
 *
 * useSceneDragDrop2D: wraps useScreenDragDrop for a 2D orthographic scene,
 * converting screen coordinates to world coordinates.
 */

import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

type Point2 = [number, number]

// ---------- useCallbackRef ----------

/**
 * Stable callback ref that always calls the latest closure without
 * invalidating downstream memoization. Ported from Concept/Common/utils.ts.
 */
function useCallbackRef<T extends (...args: any[]) => any>(callback: T): T {
  const ref = useRef(callback)
  useEffect(() => { ref.current = callback })
  return useMemo(() => ((...args: any[]) => ref.current?.(...args)) as T, [])
}

// ---------- useScreenDragDrop ----------

export function useScreenDragDrop<TPointerEvent extends { clientX: number; clientY: number; button: number }>(
  onStart: (initial: Point2, e: TPointerEvent) => void,
  onUpdate: (initial: Point2, current: Point2, e: MouseEvent) => void,
  onComplete: (initial: Point2, current: Point2) => void,
) {
  const [isDragging, setIsDragging] = useState(false)

  const completed = useRef(true)
  const initialPosition = useRef<Point2>([0, 0])
  const currentPosition = useRef<Point2>([0, 0])

  const onMouseDown = useCallbackRef((e: TPointerEvent) => {
    if (e.button !== 0) return
    initialPosition.current = [e.clientX, e.clientY]
    currentPosition.current = [e.clientX, e.clientY]
    completed.current = false
    onStart(initialPosition.current, e)
    setIsDragging(true)
  })

  const onMouseUp = useCallbackRef(() => {
    completed.current = true
    setIsDragging(false)
    onComplete(initialPosition.current, currentPosition.current)
  })

  const onMouseMove = useCallbackRef((e: MouseEvent) => {
    if (completed.current) return
    const current = currentPosition.current
    const newPoint: Point2 = [e.clientX, e.clientY]
    if (current[0] === newPoint[0] && current[1] === newPoint[1]) return
    currentPosition.current = newPoint
    onUpdate(initialPosition.current, currentPosition.current, e)
  })

  const onKeyDown = useCallbackRef((e: KeyboardEvent) => {
    if (completed.current) return
    if (e.key === 'Escape') {
      removeEvents()
      completed.current = true
      setIsDragging(false)
      onComplete(initialPosition.current, initialPosition.current)
    }
  })

  const addEvents = useCallbackRef(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { capture: true })
    window.addEventListener('keydown', onKeyDown)
  })

  const removeEvents = useCallbackRef(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', handleMouseUp, { capture: true })
    window.removeEventListener('keydown', onKeyDown)
  })

  const handleMouseUp = useCallbackRef((e: MouseEvent) => {
    removeEvents()
    onMouseUp()
  })

  const onDrag = useCallbackRef((e: TPointerEvent) => {
    onMouseDown(e)
    addEvents()
  })

  // Cleanup on unmount
  useEffect(() => removeEvents, [removeEvents])

  return { onDrag, isDragging }
}

// ---------- useSceneDragDrop2D ----------

const _vec3 = new THREE.Vector3()

/** Convert screen-relative point [clientX, clientY] to world XY via orthographic unproject. */
function screenToWorld(
  clientX: number, clientY: number,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): Point2 {
  const rect = canvas.getBoundingClientRect()
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
  _vec3.set(ndcX, ndcY, 0).unproject(camera)
  return [_vec3.x, _vec3.y]
}

/**
 * Scene-space drag-drop for 2D orthographic viewports.
 *
 * Returns `onDrag` — assign it to an R3F element's `onPointerDown`.
 * The `onUpdate` and `onComplete` callbacks receive world-space coordinates.
 */
export function useSceneDragDrop2D(
  onSceneStart: (worldPt: Point2, e: ThreeEvent<PointerEvent>) => void,
  onSceneUpdate: (worldPt: Point2) => void,
  onSceneComplete: () => void,
) {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)

  const { onDrag, isDragging } = useScreenDragDrop<ThreeEvent<PointerEvent>>(
    (initial, e) => {
      const world = screenToWorld(initial[0], initial[1], camera, canvas)
      onSceneStart(world, e)
    },
    (_initial, current) => {
      const world = screenToWorld(current[0], current[1], camera, canvas)
      onSceneUpdate(world)
    },
    () => {
      onSceneComplete()
    },
  )

  return { onDrag, isDragging }
}
