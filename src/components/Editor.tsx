import MonacoEditor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '@/store'
import { parse } from '@/lang/parser'
import { showProgram } from '@/lang/ast'

export function Editor() {
  const code = useStore((s) => s.code)
  const setCode = useStore((s) => s.setCode)

  function handleMount(ed: editor.IStandaloneCodeEditor) {
    ed.addAction({
      id: 'qsynth-parse',
      label: 'Parse Program',
      keybindings: [
        // Monaco KeyMod.CtrlCmd | Monaco KeyCode.KeyS
        // CtrlCmd = 2048, KeyS = 49
        2048 | 49,
      ],
      run: () => {
        const src = ed.getValue()
        try {
          const ast = parse(src)
          console.log('[qsynth] AST:', ast)
          console.log('[qsynth] show:\n' + showProgram(ast))
        } catch (e) {
          console.error('[qsynth] parse error:', e)
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
