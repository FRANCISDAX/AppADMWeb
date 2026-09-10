import { X, Keyboard, ScanBarcode } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'

type EscanearCodigoProps = {
  onDetectado: (codigo: string) => void
  open: boolean
  onClose: () => void
}

export function EscanearCodigo({ onDetectado, open, onClose }: EscanearCodigoProps) {
  const [codigo, setCodigo] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setCodigo('')
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSubmit = () => {
    const val = codigo.trim()
    if (!val) return
    onDetectado(val)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-primary" />
            <h3 className="font-bold">Escanear código</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted cursor-pointer" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Escanear o ingresar código..."
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-full rounded-xl border-2 border-primary/30 bg-background px-4 py-4 text-center text-xl font-mono tracking-[0.3em] focus:border-primary focus:outline-none"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Keyboard className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>

          <Button onClick={handleSubmit} className="w-full py-6 text-lg" disabled={!codigo.trim()}>
            Buscar producto
          </Button>

          <p className="text-center text-[11px] text-muted-foreground">
            Conectá la lectora USB y escaneá directamente
          </p>
        </div>
      </div>
    </div>
  )
}
