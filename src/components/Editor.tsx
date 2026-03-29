import MonacoEditor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '@/store'
import { runProgram } from '@/execute'

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
        const store = useStore.getState()
        store.setCode(src)
        store.saveProgram()
        runProgram(src)
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
