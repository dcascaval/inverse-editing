import { create } from 'zustand'

export interface Slider {
  name: string
  min: number
  max: number
  step: number
  value: number
}

interface Store {
  code: string
  setCode: (code: string) => void

  sliders: Slider[]
  setSliders: (sliders: Slider[]) => void
  setSliderValue: (name: string, value: number) => void
}

export const useStore = create<Store>((set) => ({
  code: '',
  setCode: (code) => set({ code }),

  sliders: [],
  setSliders: (sliders) => set({ sliders }),
  setSliderValue: (name, value) =>
    set((state) => ({
      sliders: state.sliders.map((s) =>
        s.name === name ? { ...s, value } : s
      ),
    })),
}))
