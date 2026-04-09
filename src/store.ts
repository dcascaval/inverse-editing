import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DrawBatch } from '@/lang/interpreter'
import type { Tape } from '@/lang/grad'
import type { LineageGraph } from '@/lang/lineage'

export type Slider = {
  name: string
  min: number
  max: number
  step: number
  value: number
}

export type Program = {
  name: string
  code: string
}

type Store = {
  // Program management
  programs: Program[]
  activeIndex: number
  code: string

  setCode: (code: string) => void
  setName: (name: string) => void
  saveProgram: () => void
  selectProgram: (index: number) => void
  newProgram: () => void
  deleteProgram: () => void

  // Sliders
  sliders: Slider[]
  setSliders: (sliders: Slider[]) => void
  setSliderValue: (name: string, value: number) => void

  // Scene (not persisted)
  scene: DrawBatch[]
  setScene: (batches: DrawBatch[]) => void

  // AD tape (not persisted)
  tape: Tape | null
  setTape: (tape: Tape | null) => void

  // Lineage graph (not persisted)
  lineage: LineageGraph | null
  setLineage: (g: LineageGraph | null) => void

  // Vertex locks (not persisted — cleared on program change)
  locks: VertexLock[]
  addLock: (lock: VertexLock) => void
  removeLock: (rootIndices: Set<number>) => void
  clearLocks: () => void

  // Locks that were active at drag start (for displaying inert-during-drag locks)
  dragActiveLockKeys: Set<string>
  setDragActiveLockKeys: (v: Set<string>) => void

  // Error (not persisted)
  error: string | null
  setError: (error: string | null) => void

  // Camera mode (not persisted)
  cameraMode: '2d' | '3d'
  setCameraMode: (mode: '2d' | '3d') => void
}

/** A locked vertex identified by its root primitive lineage */
export type VertexLock = {
  /** Root primitive indices that identify this vertex via lineage */
  rootIndices: Set<number>
  /** Tape node indices for x/y (valid for current tape only, updated on re-execution) */
  tapeXIdx: number
  tapeYIdx: number
  /** Whether this lock resolved to an actual output vertex on last re-execution */
  active: boolean
}

const DEFAULT_CODE = 'parameters {\n}\n'

const exampleFiles = import.meta.glob('../examples/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** Merge example programs into the store, skipping names that already exist. */
export function loadExamples() {
  const { programs } = useStore.getState()
  const existingNames = new Set(programs.map((p) => p.name))
  const toAdd: Program[] = []

  for (const [path, code] of Object.entries(exampleFiles)) {
    const file = path.split('/').pop()!.replace(/\.txt$/, '')
    const name = `examples/${file}`
    if (!existingNames.has(name)) {
      toAdd.push({ name, code })
    }
  }

  const hadUserPrograms = programs.some((p) => p.name && p.name !== 'untitled')
  const allPrograms = toAdd.length > 0 ? [...programs, ...toAdd] : programs

  if (toAdd.length > 0) {
    useStore.setState({ programs: allPrograms })
  }

  if (!hadUserPrograms) {
    const idx = allPrograms.findIndex((p) => p.name === 'examples/rectangle')
    if (idx >= 0) {
      useStore.setState({ activeIndex: idx, code: allPrograms[idx].code })
    }
  }
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      programs: [{ name: 'untitled', code: DEFAULT_CODE }],
      activeIndex: 0,
      code: DEFAULT_CODE,

      setCode: (code) => set({ code }),

      setName: (name) => {
        const { programs, activeIndex } = get()
        const updated = [...programs]
        updated[activeIndex] = { ...updated[activeIndex], name }
        set({ programs: updated })
      },

      saveProgram: () => {
        const { programs, activeIndex, code } = get()
        const updated = [...programs]
        updated[activeIndex] = { ...updated[activeIndex], code }
        set({ programs: updated })
      },

      selectProgram: (index) => {
        const { programs, activeIndex, code } = get()
        if (index < 0 || index >= programs.length) return
        // Save current program before switching
        const updated = [...programs]
        updated[activeIndex] = { ...updated[activeIndex], code }
        set({ programs: updated, activeIndex: index, code: updated[index].code })
      },

      newProgram: () => {
        const { programs } = get()
        const newProg: Program = { name: 'untitled', code: DEFAULT_CODE }
        const updated = [...programs, newProg]
        set({ programs: updated, activeIndex: updated.length - 1, code: DEFAULT_CODE })
      },

      deleteProgram: () => {
        const { programs, activeIndex } = get()
        if (programs.length <= 1) return
        const updated = programs.filter((_, i) => i !== activeIndex)
        const newIndex = Math.min(activeIndex, updated.length - 1)
        set({ programs: updated, activeIndex: newIndex, code: updated[newIndex].code })
      },

      sliders: [],
      setSliders: (sliders) => set({ sliders }),
      setSliderValue: (name, value) =>
        set((state) => ({
          sliders: state.sliders.map((s) =>
            s.name === name ? { ...s, value } : s,
          ),
        })),

      scene: [],
      setScene: (scene) => set({ scene }),

      tape: null,
      setTape: (tape) => set({ tape }),

      lineage: null,
      setLineage: (lineage) => set({ lineage }),

      locks: [],
      addLock: (lock) => set((s) => ({ locks: [...s.locks, lock] })),
      removeLock: (rootIndices) =>
        set((s) => ({
          locks: s.locks.filter((l) => {
            if (l.rootIndices.size !== rootIndices.size) return true
            for (const idx of rootIndices) {
              if (!l.rootIndices.has(idx)) return true
            }
            return false
          }),
        })),
      clearLocks: () => set({ locks: [] }),

      dragActiveLockKeys: new Set<string>(),
      setDragActiveLockKeys: (dragActiveLockKeys) => set({ dragActiveLockKeys }),

      error: null,
      setError: (error) => set({ error }),

      cameraMode: '2d',
      setCameraMode: (cameraMode) => set({ cameraMode }),
    }),
    {
      name: 'qsynth-store',
      partialize: (state) => ({
        programs: state.programs,
        activeIndex: state.activeIndex,
        code: state.code,
      }),
    },
  ),
)
