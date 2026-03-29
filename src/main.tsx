import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'
import { runProgram } from '@/execute'

createRoot(document.getElementById('root')!).render(<App />)

// Execute the restored program on page load
runProgram()
