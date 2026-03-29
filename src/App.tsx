import { Viewport } from '@/components/Viewport'
import { Editor } from '@/components/Editor'
import { SliderPanel } from '@/components/SliderPanel'
import { ProgramBar } from '@/components/ProgramBar'
import { ErrorToast } from '@/components/ErrorToast'

export default function App() {
  return (
    <div className="flex h-full bg-zinc-900 text-zinc-100">
      <div className="flex-1 min-w-0">
        <Viewport />
      </div>
      <div className="flex flex-col w-[50%] min-w-0 border-l border-zinc-700">
        <ProgramBar />
        <SliderPanel />
        <div className="relative flex-1 min-h-0">
          <Editor />
          <ErrorToast />
        </div>
      </div>
    </div>
  )
}
