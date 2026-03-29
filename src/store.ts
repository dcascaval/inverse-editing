import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DrawBatch } from '@/lang/interpreter'

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

  // Error (not persisted)
  error: string | null
  setError: (error: string | null) => void
}

const DEFAULT_CODE = 'parameters {\n}\n'

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
        const { programs } = get()
        if (index < 0 || index >= programs.length) return
        set({ activeIndex: index, code: programs[index].code })
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

      error: null,
      setError: (error) => set({ error }),
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
