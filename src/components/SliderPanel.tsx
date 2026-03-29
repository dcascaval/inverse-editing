import { useStore } from '@/store'
import { rerunProgram } from '@/execute'

export function SliderPanel() {
  const sliders = useStore((s) => s.sliders)
  const setSliderValue = useStore((s) => s.setSliderValue)

  function handleChange(name: string, value: number) {
    setSliderValue(name, value)
    // Re-execute after zustand state settles (synchronous)
    requestAnimationFrame(() => rerunProgram())
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 px-3 py-2 border-b border-zinc-700 bg-zinc-800 text-sm min-h-8">
      {sliders.length === 0 && (
        <span className="text-zinc-600 italic">no parameters</span>
      )}
      {sliders.map((s) => (
        <label key={s.name} className="flex items-center gap-2">
          <span className="text-zinc-400">{s.name}</span>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={s.value}
            onChange={(e) => handleChange(s.name, parseFloat(e.target.value))}
            className="w-24 accent-zinc-400"
          />
          <span className="w-10 text-right tabular-nums text-zinc-300">
            {s.value.toFixed(2)}
          </span>
        </label>
      ))}
    </div>
  )
}
