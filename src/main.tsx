import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'
import { runProgram } from '@/execute'
import { loadExamples } from '@/store'
import nlopt from '@/vendor/nlopt'

// Preload NLOpt WASM so it's ready for drag-to-optimize
nlopt.ready.catch((e) => console.warn('NLOpt failed to load:', e))

createRoot(document.getElementById('root')!).render(<App />)

// Merge example programs into storage, then execute
loadExamples()
runProgram()
