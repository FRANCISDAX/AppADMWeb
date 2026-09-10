import { Building2, Check, CloudUpload, Loader2, Printer, Receipt, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermisos } from '@/context/permisos'
import { CONFIG_POR_DEFECTO, TIPOS_REGIMEN } from '@/constants/tributario'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'sunat', label: 'SUNAT', icon: Receipt },
  { id: 'impresora', label: 'Impresora', icon: Printer },
] as const

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 600
        const min = Math.min(img.width, img.height)
        const size = Math.min(MAX, min)
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas no disponible'))
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.onerror = () => reject(new Error('Imagen inválida'))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

type Cfg = typeof CONFIG_POR_DEFECTO

export function Configuracion() {
  const { tienePermiso } = usePermisos()
  const { config, setConfig, loading, saving, guardar } = useConfiguracion()
  const [tab, setTab] = React.useState<'empresa' | 'sunat' | 'impresora'>('empresa')
  const [toast, setToast] = React.useState<string | null>(null)
  const [probando, setProbando] = React.useState(false)

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  async function onGuardar() {
    const r = await guardar()
    setToast(r.success ? '✅ Configuración guardada' : '❌ ' + (r.error ?? 'Error'))
  }

  async function probarServidor() {
    const url = String(config.servidor || '').replace(/\/+$/, '')
    if (!url) return setToast('⚠️ Ingresa la URL del servidor')
    setProbando(true)
    try {
      const res = await fetch(`${url}/test`, { method: 'POST', signal: AbortSignal.timeout(8000) })
      setToast(res.ok ? '✅ Servidor de impresión OK' : '❌ El servidor respondió ' + res.status)
    } catch (e) {
      setToast('❌ No se pudo conectar: ' + (e as Error).message)
    } finally {
      setProbando(false)
    }
  }

  if (!tienePermiso('configuracion')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <CloudUpload className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso a Configuración</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando configuración…</span>
      </div>
    )
  }

  const Field = ({ label, k, placeholder, type, inputMode }: { label: string; k: keyof Cfg; placeholder?: string; type?: string; inputMode?: 'decimal' | 'numeric' }) => (
    <div>
      <Label>{label}</Label>
      <Input
        type={type ?? 'text'}
        inputMode={inputMode}
        value={String(config[k] ?? '')}
        onChange={(e) => set(k, (e.target.value as Cfg[typeof k]))}
        placeholder={placeholder}
      />
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer',
              tab === t.id ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'empresa' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Datos de la Empresa</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">Información que aparece en los comprobantes</p>
            <div className="space-y-3">
              <Field label="Razón Social" k="nombre" placeholder="Razón social" />
              <Field label="RUC" k="ruc" placeholder="20600000000" inputMode="numeric" />
              <Field label="Dirección Fiscal" k="direccion" placeholder="Av. Principal 123" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Correo" k="correo" placeholder="correo@empresa.pe" type="email" />
                <Field label="Teléfono" k="telefono" placeholder="999 888 777" type="tel" />
              </div>
              <Field label="Sucursal" k="sucursal" placeholder="Sucursal Principal" />
              <div>
                <Label>Mensaje en comprobantes</Label>
                <textarea
                  value={String(config.mensaje ?? '')}
                  onChange={(e) => set('mensaje', e.target.value)}
                  placeholder="¡Gracias por su preferencia!"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
              <div>
                <Label>Logotipo</Label>
                {config.logo_url ? (
                  <div className="relative inline-block">
                    <img src={config.logo_url} alt="logo" className="h-24 w-24 rounded-lg object-contain" />
                    <button
                      onClick={() => set('logo_url', '')}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-destructive shadow cursor-pointer"
                      aria-label="Quitar logo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground hover:bg-accent">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        try {
                          const url = await readImageAsDataUrl(f)
                          set('logo_url', url)
                        } catch (err) {
                          setToast('❌ ' + (err as Error).message)
                        }
                      }}
                    />
                    <span>Logo</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Tributario</h2>
            </div>
            <Label>Régimen</Label>
            <div className="mb-3 mt-1 flex flex-wrap gap-2">
              {TIPOS_REGIMEN.map((r) => (
                <button
                  key={r.id}
                  onClick={() => set('tipoRegimen', r.id as Cfg['tipoRegimen'])}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer',
                    config.tipoRegimen === r.id ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => set('regionExonerada', !config.regionExonerada)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border p-3 text-sm cursor-pointer',
                config.regionExonerada ? 'border-emerald-300 bg-emerald-50' : 'border-input'
              )}
            >
              <span className={cn('font-medium', config.regionExonerada && 'text-emerald-700')}>
                Región exonerada de IGV (Amazonía)
              </span>
              <span className={cn('rounded-md px-2.5 py-1 text-xs font-bold text-white', config.regionExonerada ? 'bg-emerald-600' : 'bg-slate-400')}>
                {config.regionExonerada ? 'SÍ' : 'NO'}
              </span>
            </button>
          </div>
        </div>
      )}

      {tab === 'sunat' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <CloudUpload className="h-5 w-5 text-primary" />
              <h2 className="font-bold">API Consulta DNI/RUC</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Endpoint para consultar DNI y RUC. Si se deja vacío, se usa la variable de entorno.</p>
            <Field label="URL del endpoint" k="consultaApiBase" placeholder="https://.../prod" />
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <CloudUpload className="h-5 w-5 text-primary" />
              <h2 className="font-bold">API SUNAT</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Base de la API de facturación. El path se agrega automáticamente.</p>
            <div className="space-y-3">
              <Field label="Modo Prueba" k="sunatApiUrlTest" placeholder="https://.../prod" />
              <Field label="Producción" k="sunatApiUrlProd" placeholder="https://.../prod" />
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Boletas</h2>
            </div>
            <Label>Tope sin DNI (S/)</Label>
            <Input
              value={String(config.topeBoletaDni ?? 700)}
              onChange={(e) => set('topeBoletaDni', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
              placeholder="700"
              inputMode="decimal"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">Boletas con total mayor a este tope exigen DNI (norma SUNAT).</p>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Series</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Series para cada tipo de comprobante</p>
            <div className="space-y-3">
              <Field label="Prefijo Nota de Venta" k="serie_prefijo" placeholder="BB02" />
              <Field label="Serie Boleta" k="serieBoleta" placeholder="B001" />
              <Field label="Serie Factura" k="serieFactura" placeholder="F001" />
              <div className="h-px bg-border" />
              <Field label="Serie NC Boleta" k="serieBoletaNC" placeholder="BC01" />
              <Field label="Serie ND Boleta" k="serieBoletaND" placeholder="BD01" />
              <Field label="Serie NC Factura" k="serieFacturaNC" placeholder="FC01" />
              <Field label="Serie ND Factura" k="serieFacturaND" placeholder="FD01" />
            </div>
          </div>
        </div>
      )}

      {tab === 'impresora' && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            <h2 className="font-bold">Impresora Térmica</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">Servidor de impresión por red (ticketera 80mm).</p>
          <Field label="Servidor de impresión (URL)" k="servidor" placeholder="http://192.168.1.5:3000" />
          <Button variant="secondary" className="mt-4" onClick={probarServidor} disabled={probando}>
            {probando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {probando ? 'Probando…' : 'Probar servidor'}
          </Button>
        </div>
      )}

      <Button className="w-full" size="lg" onClick={onGuardar} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {saving ? 'Guardando…' : 'Guardar Configuración'}
      </Button>

      <div className={cn('pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      </div>
    </div>
  )
}
