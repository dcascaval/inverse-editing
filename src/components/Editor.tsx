import MonacoEditor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '@/store'
import { parse } from '@/lang/parser'
import { executeProgram } from '@/lang/interpreter'
import type { Slider } from '@/store'

export function Editor() {
  const code = useStore((s) => s.code)
  const setCode = useStore((s) => s.setCode)

  function handleMount(ed: editor.IStandaloneCodeEditor) {
    ed.addAction({
      id: 'qsynth-run',
      label: 'Run Program',
      keybindings: [2048 | 49], // CtrlCmd + S
      run: () => {
        const src = ed.getValue()
        try {
          const program = parse(src)

          // Sync sliders from parameter block
          if (program.parameters) {
            const existing = useStore.getState().sliders
            const sliders: Slider[] = program.parameters.parameters.map((p) => {
              const prev = existing.find((s) => s.name === p.name)
              return {
                name: p.name,
                min: p.bounds.min,
                max: p.bounds.max,
                step: (p.bounds.max - p.bounds.min) / 100 || 0.01,
                value: prev?.value ?? p.bounds.mid,
              }
            })
            useStore.getState().setSliders(sliders)
          }

          // Collect current slider values for execution
          const paramValues = new Map<string, number>()
          for (const s of useStore.getState().sliders) {
            paramValues.set(s.name, s.value)
          }

          const { drawBuffer, error } = executeProgram(program, paramValues)

          useStore.getState().setScene(drawBuffer.points, drawBuffer.edges)

          if (error) {
            console.error('[qsynth] runtime error:', error.message)
          }
        } catch (e) {
          console.error('[qsynth] parse error:', e)
          useStore.getState().setScene([], [])
        }
      },
    })
  }

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="plaintext"
      theme="vs-dark"
      value={code}
      onChange={(v) => setCode(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  )
}
