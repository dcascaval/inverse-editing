import { useStore } from '@/store'

export function ErrorToast() {
  const error = useStore((s) => s.error)

  if (!error) return null

  return (
    <div className="absolute bottom-3 left-3 right-3 bg-red-950/90 border border-red-800 text-red-200 text-xs font-mono px-3 py-2 rounded pointer-events-none">
      {error}
    </div>
  )
}
