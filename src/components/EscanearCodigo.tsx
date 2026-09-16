import { X, Keyboard, ScanBarcode, Camera, RotateCcw, SwitchCamera } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ES_MOVIL = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

type EscanearCodigoProps = {
  onDetectado: (codigo: string) => void
  open: boolean
  onClose: () => void
}

export function EscanearCodigo({ onDetectado, open, onClose }: EscanearCodigoProps) {
  const [modo, setModo] = React.useState<'auto' | 'manual'>(ES_MOVIL ? 'auto' : 'manual')
  const [codigo, setCodigo] = React.useState('')
  const [camaraActiva, setCamaraActiva] = React.useState(false)
  const [errorCamara, setErrorCamara] = React.useState<string | null>(null)
  const [usaTrasera, setUsaTrasera] = React.useState(true)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const scannerRef = React.useRef<any>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (open) {
      setCodigo('')
      setErrorCamara(null)
      if (ES_MOVIL) {
        setModo('auto')
        setTimeout(() => iniciarCamara(true), 100)
      } else {
        setModo('manual')
        setTimeout(() => inputRef.current?.focus(), 200)
      }
    } else {
      detenerCamara()
    }
    return () => detenerCamara()
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (camaraActiva) detenerCamara()
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, camaraActiva])

  async function iniciarCamara(trasera: boolean) {
    try {
      setErrorCamara(null)
      setCamaraActiva(false)
      const { Html5Qrcode } = await import('html5-qrcode')

      // Limpiar contenedor
      if (containerRef.current) containerRef.current.innerHTML = ''

      const scanner = new Html5Qrcode('scanner-container')
      scannerRef.current = scanner

      const camaras = await Html5Qrcode.getCameras()
      if (!camaras || camaras.length === 0) {
        setErrorCamara('No se encontraron cámaras en este dispositivo.')
        setModo('manual')
        return
      }

      // Elegir cámara trasera o frontal
      let cameraId = camaras[0].id
      if (trasera) {
        const traseraCam = camaras.find((c: any) =>
          c.label.toLowerCase().includes('back') ||
          c.label.toLowerCase().includes('trasera') ||
          c.label.toLowerCase().includes('rear') ||
          c.label.toLowerCase().includes('environment')
        )
        if (traseraCam) cameraId = traseraCam.id
      } else {
        const frontalCam = camaras.find((c: any) =>
          c.label.toLowerCase().includes('front') ||
          c.label.toLowerCase().includes('delantera') ||
          c.label.toLowerCase().includes('user')
        )
        if (frontalCam) cameraId = frontalCam.id
      }

      await scanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          aspectRatio: 1.777,
        },
        (decodedText: string) => {
          onDetectado(decodedText)
          detenerCamara()
          onClose()
        },
        () => {}
      )

      setCamaraActiva(true)
      setUsaTrasera(trasera)
    } catch (e) {
      console.error('Error al iniciar cámara:', e)
      setErrorCamara('No se pudo acceder a la cámara. Verificá los permisos del navegador.')
      setModo('manual')
    }
  }

  function cambiarCamara() {
    detenerCamara()
    setTimeout(() => iniciarCamara(!usaTrasera), 100)
  }

  function detenerCamara() {
    try {
      scannerRef.current?.stop()
    } catch {}
    try {
      scannerRef.current?.clear()
    } catch {}
    scannerRef.current = null
    setCamaraActiva(false)
  }

  function handleSubmit() {
    const val = codigo.trim()
    if (!val) return
    onDetectado(val)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card p-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-primary" />
            <h3 className="font-bold">Escanear código</h3>
          </div>
          <button onClick={() => { detenerCamara(); onClose() }} className="rounded-full p-1 hover:bg-muted cursor-pointer" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selector de modo (solo en móvil) */}
        {ES_MOVIL && (
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => { detenerCamara(); setModo('auto'); setTimeout(() => iniciarCamara(true), 100) }}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
                modo === 'auto' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              <Camera className="h-4 w-4" /> Cámara
            </button>
            <button
              onClick={() => { detenerCamara(); setModo('manual'); setTimeout(() => inputRef.current?.focus(), 200) }}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
                modo === 'manual' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              <Keyboard className="h-4 w-4" /> Manual
            </button>
          </div>
        )}

        {/* Modo cámara */}
        {modo === 'auto' && (
          <div className="space-y-3">
            {errorCamara ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-sm text-destructive">{errorCamara}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => { setErrorCamara(null); iniciarCamara(true) }}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Reintentar
                </Button>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-xl border-2 border-primary/20">
                <div id="scanner-container" ref={containerRef} className="w-full min-h-[250px]" />
                {/* Botón cambiar cámara */}
                {camaraActiva && (
                  <button
                    onClick={cambiarCamara}
                    className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 cursor-pointer"
                    title={usaTrasera ? 'Cambiar a cámara frontal' : 'Cambiar a cámara trasera'}
                  >
                    <SwitchCamera className="h-5 w-5" />
                  </button>
                )}
                {/* Overlay de carga */}
                {!camaraActiva && !errorCamara && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
                    <div className="text-center">
                      <Camera className="mx-auto mb-2 h-8 w-8 animate-pulse text-primary" />
                      <p className="text-sm text-muted-foreground">Iniciando cámara trasera...</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-center text-[11px] text-muted-foreground">
              Apuntá al código de barras o QR del producto
            </p>
          </div>
        )}

        {/* Modo manual / USB */}
        {modo === 'manual' && (
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
        )}
      </div>

      <style>{`
        #scanner-container video {
          border-radius: 12px;
          width: 100% !important;
          object-fit: cover;
        }
        #scanner-container__scan_region {
          min-height: 200px;
        }
        #scanner-container__dashboard_section {
          display: none !important;
        }
      `}</style>
    </div>
  )
}
