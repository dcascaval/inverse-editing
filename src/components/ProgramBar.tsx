import { useStore } from '@/store'
import { runProgram } from '@/execute'

export function ProgramBar() {
  const programs = useStore((s) => s.programs)
  const activeIndex = useStore((s) => s.activeIndex)
  const setName = useStore((s) => s.setName)
  const selectProgram = useStore((s) => s.selectProgram)
  const newProgram = useStore((s) => s.newProgram)
  const deleteProgram = useStore((s) => s.deleteProgram)

  const active = programs[activeIndex]

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700 bg-zinc-800 text-sm">
      <select
        value={activeIndex}
        onChange={(e) => {
          selectProgram(Number(e.target.value))
          // Re-execute with new program's code and sync parameters
          runProgram()
        }}
        className="bg-zinc-700 text-zinc-200 rounded px-2 py-0.5 text-sm outline-none"
      >
        {programs.map((p, i) => (
          <option key={i} value={i}>
            {p.name || 'untitled'}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={active.name}
        onChange={(e) => setName(e.target.value)}
        placeholder="program name"
        className="flex-1 bg-transparent text-zinc-200 outline-none placeholder-zinc-500 px-1"
      />
      <button
        onClick={() => { newProgram(); runProgram() }}
        className="text-zinc-400 hover:text-zinc-200 px-1"
        title="New program"
      >
        +
      </button>
      {programs.length > 1 && (
        <button
          onClick={() => { deleteProgram(); runProgram() }}
          className="text-zinc-500 hover:text-red-400 px-1"
          title="Delete program"
        >
          &times;
        </button>
      )}
    </div>
  )
}
