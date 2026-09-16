import { AlertTriangle, ClipboardCopy, RefreshCw, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { resumenError } from '@/lib/errores'

/**
 * Pantalla que ve el usuario cuando una parte de la app revienta.
 *
 * Está separada del `ErrorBoundary` a propósito: el boundary solo maneja el
 * ciclo de vida del error y esto es UI pura, reutilizable y fácil de cambiar.
 * Muestra un mensaje entendible, permite **copiar el detalle** (para pegar el
 * error en un mensaje) y reintentar sin recargar toda la app.
 */
export function ErrorFallback({
  error,
  contexto,
  onReintentar,
  onRecargar,
}: {
  error: Error
  contexto: string
  onReintentar: () => void
  onRecargar: () => void
}) {
  const [copiado, setCopiado] = React.useState<'ok' | 'error' | null>(null)

  const detalle = resumenError({
    mensaje: error.message || 'Error',
    contexto,
    fecha: new Date().toISOString(),
    ruta: typeof window !== 'undefined' ? window.location.href : '',
    dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    stack: error.stack,
  })

  async function copiar() {
    try {
      await navigator.clipboard.writeText(detalle)
      setCopiado('ok')
    } catch {
      // En contextos sin permiso de portapapeles (o sin https) no se puede copiar.
      setCopiado('error')
    }
    setTimeout(() => setCopiado(null), 2500)
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-card">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-bold">Algo se rompió en esta pantalla</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              El error quedó <span className="font-semibold">registrado automáticamente</span> (Auditoría → Errores). Podés reintentar; tus datos no se ven
              afectados.
            </p>
          </div>
        </div>

        <p className="mt-4 break-words rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{error.message || 'Error desconocido'}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onReintentar}>
            <RotateCcw className="h-4 w-4" /> Reintentar
          </Button>
          <Button variant="outline" onClick={onRecargar}>
            <RefreshCw className="h-4 w-4" /> Recargar la app
          </Button>
          <Button variant="ghost" onClick={copiar}>
            <ClipboardCopy className="h-4 w-4" /> {copiado === 'ok' ? '¡Copiado!' : copiado === 'error' ? 'No se pudo copiar' : 'Copiar detalle'}
          </Button>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">Ver detalle técnico</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-[11px] text-muted-foreground">{detalle}</pre>
        </details>
      </div>
    </div>
  )
}
