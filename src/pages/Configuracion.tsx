import { AlertTriangle, BellRing, Building2, Check, CloudUpload, CreditCard, FlaskConical, Loader2, Package, Percent, Printer, Receipt, Smartphone, Tag, Trash2, Truck, Users, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { EstadoPuenteYape } from '@/components/EstadoPuenteYape'
import { AFECTACION_POR_DEFECTO, CONFIG_POR_DEFECTO, TIPO_AFECTACION, TIPOS_REGIMEN } from '@/constants/tributario'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'
import { validarSeriesEmpresa, type SerieOcupada } from '@/lib/series'
import { vigenciaYapeMinutos } from '@/lib/yape'
import { cn } from '@/lib/utils'
import { obtenerSeriesOcupadas } from '@/services/usuarios'
import { borrarAvisosDePrueba, crearAvisoDePrueba } from '@/services/yape'
import { guardarPromocionVolumen, eliminarPromocionVolumen, listarPromocionesVolumen, type PromocionVolumen } from '@/services/promociones-volumen'
import { cargarCajas, guardarCaja, eliminarCaja, CAJA_POR_DEFECTO, type Caja } from '@/services/cajas'
import { moverPedidosDeCaja } from '@/services/ventas'

const TABS = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'sunat', label: 'SUNAT', icon: Receipt },
  { id: 'impresora', label: 'Impresora', icon: Printer },
  { id: 'envio', label: 'Envío', icon: Truck },
  { id: 'plantillas', label: 'Plantillas', icon: Package },
  { id: 'listas', label: 'Listas de Precio', icon: Tag },
  { id: 'promos', label: 'Promociones', icon: Percent },
  { id: 'yape', label: 'Yape', icon: Smartphone },
  { id: 'alertas', label: 'Alertas', icon: BellRing },
  { id: 'cajas', label: 'Cajas', icon: CreditCard },
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
  const { tienePermiso, nombre: nombreUsuario } = usePermisos()
  const { config, setConfig, loading, saving, guardar } = useConfiguracion()
  const [tab, setTab] = React.useState<'empresa' | 'sunat' | 'impresora' | 'envio' | 'plantillas' | 'listas' | 'promos' | 'yape' | 'alertas' | 'cajas'>('empresa')
  const [toast, setToast] = React.useState<string | null>(null)
  const [probando, setProbando] = React.useState(false)
  const [seriesOcupadas, setSeriesOcupadas] = React.useState<SerieOcupada[]>([])
  /** Aviso de prueba de Yape (pestaña Yape): monto y estado del botón. */
  const [montoPrueba, setMontoPrueba] = React.useState('0.10')
  const [creandoPrueba, setCreandoPrueba] = React.useState(false)

  // Series globales vs. series por caja: las cajas sin serie propia numeran con
  // la global, así que un choque significa compartir contador de correlativos.
  React.useEffect(() => {
    let vigente = true
    obtenerSeriesOcupadas()
      .then((ocupadas) => {
        if (vigente) setSeriesOcupadas(ocupadas)
      })
      .catch((e) => console.error('❌ obtenerSeriesOcupadas:', e))
    return () => {
      vigente = false
    }
  }, [])

  const conflictosSeries = React.useMemo(
    () => validarSeriesEmpresa({ config: config as unknown as Record<string, unknown>, ocupadas: seriesOcupadas }),
    [config, seriesOcupadas]
  )
  const erroresSeries = conflictosSeries.filter((c) => c.bloqueante)
  const avisosSeries = conflictosSeries.filter((c) => !c.bloqueante)

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
        <p className="text-sm font-medium">No tienes acceso a Configuración</p>
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

  const plantillas = (config.plantillasManuales ?? []) as { id: string; nombre: string; precio: number }[]

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
      <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-muted p-1 scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition-colors cursor-pointer',
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

            <button
              onClick={() => set('conteoCiego', !config.conteoCiego)}
              className={cn(
                'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm cursor-pointer',
                config.conteoCiego ? 'border-amber-300 bg-amber-50' : 'border-input'
              )}
            >
              <span>
                <span className={cn('font-medium', config.conteoCiego && 'text-amber-700')}>
                  Conteo ciego al cerrar el turno
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  El cajero escribe cuánto contó <b>sin ver</b> el “Debería haber”; recién después
                  el sistema muestra la diferencia. Evita que se “cuadre” copiando el esperado.
                </span>
              </span>
              <span className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs font-bold text-white', config.conteoCiego ? 'bg-amber-600' : 'bg-slate-400')}>
                {config.conteoCiego ? 'SÍ' : 'NO'}
              </span>
            </button>

            <div className="rounded-lg border p-3">
              <Label className="font-medium">Descuento manual máximo (%)</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tope para el descuento que carga una persona en el PDV (global). <b>0 = sin tope.</b>
                No afecta a las promociones ni a los descuentos configurados (volumen, producto,
                cliente), que se siguen aplicando solos. Quién puede aplicar el descuento manual se
                define por usuario con el permiso <b>«Aplicar descuento manual»</b>.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  placeholder="0"
                  value={String(config.descuentoMaximoPorcentaje ?? '')}
                  onChange={(e) => set('descuentoMaximoPorcentaje', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="h-8 w-24 text-xs"
                />
                <span className="text-xs text-muted-foreground">
                  {(Number(config.descuentoMaximoPorcentaje) || 0) === 0 ? 'Sin tope' : `Máximo ${config.descuentoMaximoPorcentaje}%`}
                </span>
              </div>
            </div>
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

          {/* 🔑 Receptor de la BOLETA CONSOLIDADA: una consolidada agrupa las notas de venta del
              día, así que no tiene un cliente real — el nombre es un rótulo que se imprime en el
              papel y se declara a SUNAT. Antes estaba fijo en 'CONSUMIDOR FINAL' (el consolidador
              ya leía estos campos, pero no había dónde configurarlos). */}
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Boleta consolidada</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Con qué <span className="font-semibold">receptor</span> sale la boleta que agrupa las notas de venta del día
              (<em>Reportes → Consolidado de Boletas</em>). Algunos negocios prefieren «VENTAS DEL DÍA», «CLIENTES VARIOS» u otro rótulo.
            </p>
            <div className="space-y-3">
              <div>
                <Label>Nombre del receptor</Label>
                <Input
                  value={String(config.clienteDefaultNombre ?? '')}
                  onChange={(e) => set('clienteDefaultNombre', e.target.value)}
                  placeholder="CONSUMIDOR FINAL"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Se imprime en la boleta y se declara a SUNAT. Si lo dejas vacío, vuelve a
                  <span className="font-semibold"> «CONSUMIDOR FINAL»</span>.
                </p>
              </div>
              <div>
                <Label>Documento del receptor</Label>
                <Input
                  value={String(config.clienteDefaultDni ?? '')}
                  onChange={(e) => set('clienteDefaultDni', e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="00000000"
                  inputMode="numeric"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold">00000000</span> = documento que no domina (lo habitual en una consolidada).
                  ⚠️ Cambiar el nombre o el documento es una decisión fiscal: confírmalo con tu contador.
                </p>
              </div>
            </div>
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
              <div className="h-px bg-border" />
              <div>
                <Label>Punto de emisión (anexo)</Label>
                <Input
                  value={String(config.puntoEmision ?? '0000')}
                  onChange={(e) => set('puntoEmision', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                  inputMode="numeric"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Código de establecimiento anexo (catálogo 22) del emisor. <span className="font-semibold">0000</span> = casa matriz. Va dentro del XML
                  firmado, así que forma parte del hash SUNAT.
                </p>
              </div>
              <div>
                <Label>Afectación de los items manuales</Label>
                <select
                  value={String(config.tipoAfectacionManual ?? AFECTACION_POR_DEFECTO)}
                  onChange={(e) => set('tipoAfectacionManual', e.target.value)}
                  className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {TIPO_AFECTACION.map((a) => (
                    <option key={a.codigo} value={a.codigo}>
                      {a.codigo} · {a.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Con qué afectación se declaran los items manuales del PDV (los de <span className="font-semibold">"Embalaje y Otros"</span>: hielo, bolsas,
                  embalaje) cuando llevan comprobante. <span className="font-semibold">Tiene que coincidir con la afectación de tu catálogo</span>: si los
                  productos son exonerados (20) y el manual va gravado (10), el comprobante le suma 18% de IGV y declara más de lo que cobras.
                </p>
              </div>
            </div>
            {erroresSeries.map((c, i) => (
              <p key={`error-${i}`} className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{c.mensaje}</span>
              </p>
            ))}
            {avisosSeries.map((c, i) => (
              <p key={`aviso-${i}`} className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{c.mensaje}</span>
              </p>
            ))}
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

      {tab === 'envio' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Envío a Domicilio</h2>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.envioHabilitado === true}
                onChange={(e) => set('envioHabilitado' as any, e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Habilitar envíos a domicilio
            </label>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Zonas de Envío</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Configurá las zonas y costos de envío.</p>
            <div className="space-y-2">
              {(config.zonasEnvio ?? []).map((zona: any, idx: number) => (
                <div key={zona.id || idx} className="flex items-center gap-2">
                  <input
                    value={zona.nombre}
                    onChange={(e) => {
                      const nuevas = [...(config.zonasEnvio ?? [])]
                      nuevas[idx] = { ...nuevas[idx], nombre: e.target.value }
                      set('zonasEnvio' as any, nuevas)
                    }}
                    placeholder="Nombre de zona"
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                  />
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">S/</span>
                    <input
                      type="number"
                      value={zona.costo}
                      onChange={(e) => {
                        const nuevas = [...(config.zonasEnvio ?? [])]
                        nuevas[idx] = { ...nuevas[idx], costo: Number(e.target.value) || 0 }
                        set('zonasEnvio' as any, nuevas)
                      }}
                      className="h-9 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm"
                      inputMode="decimal"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const nuevas = (config.zonasEnvio ?? []).filter((_: any, i: number) => i !== idx)
                      set('zonasEnvio' as any, nuevas)
                    }}
                    className="text-destructive hover:text-destructive/80 cursor-pointer"
                    aria-label="Eliminar zona"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                const nuevas = [...(config.zonasEnvio ?? []), { id: `zona_${Date.now()}`, nombre: '', costo: 0 }]
                set('zonasEnvio' as any, nuevas)
              }}
            >
              + Agregar zona
            </Button>
          </div>
        </div>
      )}

      {tab === 'plantillas' && (
        <PlantillasTab plantillas={plantillas} setPlantillas={(p) => set('plantillasManuales', p)} />
      )}

      {tab === 'listas' && (
        <ListasPrecioTab listas={config.listasPrecios ?? []} setListas={(l) => set('listasPrecios' as any, l)} />
      )}

      {tab === 'promos' && <PromocionesTab />}

      {/* 🔑 **Avisos de pago de Yape.** Cuando el cliente yapea, el celular del negocio recibe el
          aviso: acá se define si el PDV lo muestra, cuánto vale ese aviso y si suena. Los avisos
          los escribe el **puente** (el que lee el aviso real); el PDV solo los usa. */}
      {tab === 'yape' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Avisos de pago de Yape</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Cuando el cliente yapea, el PDV muestra un aviso con el monto y el nombre, y desde ahí
              el cajero lo aplica a la venta con <span className="font-semibold">«Usar en esta venta»</span> —
              sin mirar el celular y sin escribir el monto a mano.
            </p>

            <div className="space-y-3">
              <button
                onClick={() => set('yapeAvisoActivo', !config.yapeAvisoActivo)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm cursor-pointer',
                  config.yapeAvisoActivo ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'border-input'
                )}
              >
                <span>
                  <span className={cn('font-medium', config.yapeAvisoActivo && 'text-emerald-700 dark:text-emerald-300')}>
                    Mostrar los avisos en el PDV
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Si está apagado, el PDV no muestra ningún aviso (la venta por Yape se sigue cobrando
                    a mano, como siempre).
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs font-bold text-white', config.yapeAvisoActivo ? 'bg-emerald-600' : 'bg-slate-400')}>
                  {config.yapeAvisoActivo ? 'SÍ' : 'NO'}
                </span>
              </button>

              <div className="rounded-lg border p-3">
                <Label className="font-medium">Vigencia de un aviso (minutos)</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Cuánto tiempo sirve un aviso para usarlo. Pasado ese rato deja de aparecer: un aviso
                  viejo aplicado a una venta de ahora es más un riesgo que una ayuda.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={120}
                    placeholder="10"
                    value={String(config.yapeVigenciaMinutos ?? '')}
                    onChange={(e) => set('yapeVigenciaMinutos', Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                    className="h-8 w-24 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">
                    {(Number(config.yapeVigenciaMinutos) || 0) <= 0 ? 'Se usa 10 min (0 no es válido acá)' : `${vigenciaYapeMinutos(config)} minutos`}
                  </span>
                </div>
              </div>

              <button
                onClick={() => set('yapeSonido', !config.yapeSonido)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm cursor-pointer',
                  config.yapeSonido ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950' : 'border-input'
                )}
              >
                <span>
                  <span className={cn('font-medium', config.yapeSonido && 'text-amber-700 dark:text-amber-300')}>
                    Sonar cuando llega un aviso
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Un pitido en el PDV. Sirve para no tener que mirar la pantalla cuando hay gente en el mostrador.
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs font-bold text-white', config.yapeSonido ? 'bg-amber-600' : 'bg-slate-400')}>
                  {config.yapeSonido ? 'SÍ' : 'NO'}
                </span>
              </button>

              <div className="rounded-lg border p-3">
                <Label className="font-medium">Número de Yape del negocio</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Se muestra en el aviso para dictárselo al cliente que todavía no yapeó (opcional).
                </p>
                <Input
                  value={String(config.yapeNumero ?? '')}
                  onChange={(e) => set('yapeNumero', e.target.value.replace(/[^\d\s+-]/g, '').slice(0, 20))}
                  placeholder="999 888 777"
                  inputMode="tel"
                  className="mt-2"
                />
              </div>

              <div className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
                <b>Cómo llegan los avisos.</b> Los escribe el <b>puente</b>: el programa que lee el aviso
                real de Yape (la notificación del celular del negocio). Hasta que el puente esté
                instalado, esta pantalla se configura pero el PDV no muestra nada. Los avisos quedan
                guardados en <span className="font-mono">tblPagosYape</span> con quién usó cada uno y en
                qué comprobante, y el cierre del turno los cruza contra los cobros por Yape.
              </div>

              {/* 🔑 El latido del puente, acá y en el PDV con el **mismo** componente: es el dato que
                  distingue «no yapeó nadie» de «el puente se murió y la plata entró igual». */}
              <div className="space-y-1">
                <Label className="font-medium">Estado del puente</Label>
                <EstadoPuenteYape />
              </div>

              {/* 🔑 Aviso de PRUEBA: la única excepción a «los avisos los crea el puente». Sirve para
                  comprobar el circuito completo (panel → usar → cobro → cruce del cierre) sin que
                  alguien yapee de verdad, y para la puesta en marcha del puente. Va marcado
                  `origen: 'prueba'` y se ve como PRUEBA en el PDV y en el cierre. */}
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  <Label className="font-medium">Probar con un aviso de prueba</Label>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Crea un aviso <b>como si hubiera yapeado alguien</b>, para ver el circuito completo en
                  el PDV (aparece arriba del carrito, se aplica a una venta y queda en el cruce del
                  cierre). ⚠️ <b>No entra plata</b>: el aviso va marcado como PRUEBA en el PDV y en el
                  cierre, y se puede borrar cuando termines.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    step={0.1}
                    placeholder="0.10"
                    value={montoPrueba}
                    onChange={(e) => setMontoPrueba(e.target.value)}
                    className="h-8 w-24 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={creandoPrueba || !(Number(montoPrueba) > 0)}
                    onClick={async () => {
                      setCreandoPrueba(true)
                      try {
                        const r = await crearAvisoDePrueba({
                          monto: Number(montoPrueba),
                          usuario: nombreUsuario || 'sistema',
                        })
                        setToast(r.success ? '✅ Aviso de prueba enviado al PDV' : `❌ ${r.error ?? 'Error'}`)
                      } finally {
                        setCreandoPrueba(false)
                      }
                    }}
                  >
                    {creandoPrueba ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    Enviar aviso de prueba
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={creandoPrueba}
                    onClick={async () => {
                      setCreandoPrueba(true)
                      try {
                        const r = await borrarAvisosDePrueba()
                        setToast(r.success ? (r.borrados > 0 ? `🧹 ${r.borrados} aviso(s) de prueba borrado(s)` : 'No había avisos de prueba') : `❌ ${r.error ?? 'Error'}`)
                      } finally {
                        setCreandoPrueba(false)
                      }
                    }}
                    title="Borra SOLO los avisos de prueba: los avisos reales (del puente) no se tocan"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Borrar los de prueba
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Para verlo tienes que estar en el PDV (el aviso sale en el panel «Yape», arriba del
                  carrito) y con los avisos encendidos acá arriba.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'alertas' && <AlertasTab config={config} set={set} />}

      {tab === 'cajas' && <CajasTab />}

      {/* 🔑 **Un guardado bloqueado tiene que decir POR QUÉ, en cualquier pestaña.** El botón de
          abajo se deshabilita por cualquier conflicto BLOQUEANTE de series, y esos mensajes solo
          se dibujan dentro de la pestaña SUNAT: desde Plantillas (o Listas, o Empresa) el admin
          agregaba items, apretaba Guardar, **no pasaba nada y no había ningún motivo a la vista** —
          al recargar, los items volvían a como estaban. Acá se muestra el motivo al lado del botón,
          salvo en SUNAT, donde ya está arriba junto a los campos de series (no se repite). */}
      {erroresSeries.length > 0 && tab !== 'sunat' && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            No se puede guardar: {erroresSeries.length === 1 ? 'hay un conflicto de series' : `hay ${erroresSeries.length} conflictos de series`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {erroresSeries.map((c, i) => (
              <li key={`bloqueo-${i}`} className="text-[11px] text-destructive">· {c.mensaje}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Ajustá las series en la pestaña <span className="font-semibold">SUNAT</span> y las series de cada persona en{' '}
            <span className="font-semibold">Usuarios</span>: dos lugares con la misma serie comparten el contador de correlativos.
          </p>
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={onGuardar}
        disabled={saving || erroresSeries.length > 0}
        title={erroresSeries.length > 0 ? 'Corrige las series duplicadas para guardar' : undefined}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {saving ? 'Guardando…' : 'Guardar Configuración'}
      </Button>

      <div className={cn('pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      </div>
    </div>
  )
}

type PlantillaItem = { id: string; nombre: string; precio: number }

function PlantillasTab({ plantillas, setPlantillas }: { plantillas: PlantillaItem[]; setPlantillas: (p: PlantillaItem[]) => void }) {
  const [nuevoNombre, setNuevoNombre] = React.useState('')
  const [nuevoPrecio, setNuevoPrecio] = React.useState('')

  function agregar() {
    const nombre = nuevoNombre.trim()
    const precio = parseFloat(nuevoPrecio) || 0
    if (!nombre || precio <= 0) return
    const nueva: PlantillaItem = { id: `tmpl_${Date.now()}`, nombre, precio }
    setPlantillas([...plantillas, nueva])
    setNuevoNombre('')
    setNuevoPrecio('')
  }

  function eliminar(id: string) {
    setPlantillas(plantillas.filter((p) => p.id !== id))
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="font-bold">Plantillas de Productos</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Productos de embalaje (cartones, cajas, bolsas, sacos) que aparecen en el PDV para agregar sin inventario.
      </p>

      {plantillas.length > 0 && (
        <div className="mb-4 space-y-2">
          {plantillas.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.nombre}</div>
                <div className="text-xs text-primary font-bold">S/ {p.precio.toFixed(2)}</div>
              </div>
              <button onClick={() => eliminar(p.id)} className="text-destructive hover:text-destructive/80 cursor-pointer" aria-label="Eliminar plantilla">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {plantillas.length === 0 && (
        <p className="mb-4 text-center text-sm text-muted-foreground py-4">No hay plantillas creadas</p>
      )}

      <div className="flex gap-2">
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          placeholder="Nombre del producto"
          className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
        />
        <div className="relative w-28">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">S/</span>
          <input
            type="number"
            value={nuevoPrecio}
            onChange={(e) => setNuevoPrecio(e.target.value)}
            placeholder="0.00"
            className="h-9 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm"
            inputMode="decimal"
          />
        </div>
        <Button
          size="sm"
          onClick={agregar}
          disabled={!nuevoNombre.trim() || !nuevoPrecio || parseFloat(nuevoPrecio) <= 0}
        >
          + Agregar
        </Button>
      </div>
    </div>
  )
}

type ListaPrecio = { id: string; nombre: string; defecto: boolean }

function ListasPrecioTab({ listas, setListas }: { listas: ListaPrecio[]; setListas: (l: ListaPrecio[]) => void }) {
  const [nuevoNombre, setNuevoNombre] = React.useState('')

  function agregar() {
    const nombre = nuevoNombre.trim()
    if (!nombre) return
    const id = nombre.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')
    if (listas.some((l) => l.id === id)) return
    setListas([...listas, { id, nombre, defecto: false }])
    setNuevoNombre('')
  }

  function eliminar(id: string) {
    setListas(listas.filter((l) => l.id !== id))
  }

  function toggleDefecto(id: string) {
    setListas(listas.map((l) => ({ ...l, defecto: l.id === id })))
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Tag className="h-5 w-5 text-primary" />
        <h2 className="font-bold">Listas de Precios</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Configurá las listas de precios disponibles. Cada producto puede tener un precio distinto por lista, y cada cliente se asocia a una lista.
      </p>

      {listas.length > 0 && (
        <div className="mb-4 space-y-2">
          {listas.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{l.nombre}</div>
                <div className="text-[10px] text-muted-foreground">ID: {l.id}</div>
              </div>
              <button
                onClick={() => toggleDefecto(l.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer',
                  l.defecto ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-accent'
                )}
              >
                {l.defecto ? 'Por defecto' : 'Usar'}
              </button>
              {!l.defecto && (
                <button onClick={() => eliminar(l.id)} className="text-destructive hover:text-destructive/80 cursor-pointer" aria-label="Eliminar lista">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {listas.length === 0 && (
        <p className="mb-4 text-center text-sm text-muted-foreground py-4">No hay listas creadas</p>
      )}

      <div className="flex gap-2">
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          placeholder="Nombre de la lista (ej: VIP, Distribuidor)"
          className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
        />
        <Button size="sm" onClick={agregar} disabled={!nuevoNombre.trim()}>
          + Agregar
        </Button>
      </div>
    </div>
  )
}

const TIPOS_PROMO = [
  { value: '3x2', label: '3×2' },
  { value: '2da_50', label: '2da al 50%' },
  { value: 'lleva_paga', label: 'Llevá X paga Y' },
  { value: 'porcentaje', label: '% por volumen' },
  { value: 'monto_fijo', label: 'Monto fijo' },
] as const

type PromoForm = {
  nombre: string
  tipo: '3x2' | '2da_50' | 'lleva_paga' | 'porcentaje' | 'monto_fijo'
  productoIds: string[]
  activo: boolean
  fechaInicio: string
  fechaFin: string
  notas: string
  lleva: string
  paga: string
  valor: string
}

const PROMO_VACIO: PromoForm = {
  nombre: '', tipo: '3x2', productoIds: [], activo: true, fechaInicio: '', fechaFin: '', notas: '', lleva: '', paga: '', valor: '',
}

function PromocionesTab() {
  const { productos } = useProductos()
  const { toast } = useNotifications()
  const [promos, setPromos] = React.useState<PromocionVolumen[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [editando, setEditando] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<PromoForm>(PROMO_VACIO)
  const [guardando, setGuardando] = React.useState(false)
  const [busquedaProd, setBusquedaProd] = React.useState('')

  React.useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setCargando(true)
    const lista = await listarPromocionesVolumen()
    setPromos(lista)
    setCargando(false)
  }

  function nueva() {
    setEditando('new')
    setForm(PROMO_VACIO)
  }

  function editar(p: PromocionVolumen) {
    setEditando(p.id ?? null)
    setForm({
      nombre: p.nombre,
      tipo: p.tipo,
      productoIds: p.productoIds,
      activo: p.activo,
      fechaInicio: p.fechaInicio ?? '',
      fechaFin: p.fechaFin ?? '',
      notas: p.notas ?? '',
      lleva: p.tipo === 'lleva_paga' ? String(Math.ceil((p.valor ?? 0) / 100)) : p.tipo === 'monto_fijo' ? String(p.valor ?? '') : '',
      paga: p.tipo === 'lleva_paga' ? String((p.valor ?? 0) % 100) : '',
      valor: p.tipo === 'porcentaje' ? String(p.valor ?? 0) : p.tipo === 'monto_fijo' ? String(p.descuento ?? '') : '',
    })
  }

  function toggleProd(id: string) {
    setForm((f) => ({
      ...f,
      productoIds: f.productoIds.includes(id) ? f.productoIds.filter((x) => x !== id) : [...f.productoIds, id],
    }))
  }

  async function guardar() {
    if (!form.nombre.trim()) return toast('⚠️ Ingrese un nombre')
    if (form.productoIds.length === 0) return toast('⚠️ Seleccione al menos un producto')
    setGuardando(true)
    let valor: number | undefined
    if (form.tipo === 'lleva_paga') {
      const l = parseInt(form.lleva) || 0
      const p = parseInt(form.paga) || 0
      if (l <= 0 || p <= 0) { setGuardando(false); return toast('⚠️ Ingrese llevá y paga válidos') }
      valor = l * 100 + p
    } else if (form.tipo === 'porcentaje') {
      valor = parseFloat(form.valor) || 0
      if (valor <= 0) { setGuardando(false); return toast('⚠️ Ingrese un porcentaje válido') }
    } else if (form.tipo === 'monto_fijo') {
      const unidades = parseInt(form.lleva) || 0
      const montoFijo = parseFloat(form.valor) || 0
      if (unidades <= 0) { setGuardando(false); return toast('⚠️ Ingrese las unidades requeridas') }
      if (montoFijo <= 0) { setGuardando(false); return toast('⚠️ Ingrese el monto fijo') }
      valor = unidades
    }
    const esNueva = !editando || editando === 'new'
    const promoData: Omit<PromocionVolumen, 'id'> & { id?: string } = {
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      productoIds: form.productoIds,
      activo: form.activo,
      valor,
      ...(form.tipo === 'monto_fijo' ? { descuento: parseFloat(form.valor) || 0 } : {}),
    }
    if (form.fechaInicio) promoData.fechaInicio = form.fechaInicio
    if (form.fechaFin) promoData.fechaFin = form.fechaFin
    if (form.notas) promoData.notas = form.notas
    if (!esNueva) promoData.id = editando
    const r = await guardarPromocionVolumen(promoData)
    setGuardando(false)
    if (r.success) {
      toast(esNueva ? '✅ Promoción creada' : '✅ Promoción actualizada')
      setEditando(null)
      setForm(PROMO_VACIO)
      cargar()
    } else {
      toast('❌ ' + (r.error || 'Error'))
    }
  }

  async function eliminar(id: string) {
    const ok = await eliminarPromocionVolumen(id)
    if (ok) {
      toast('✅ Eliminada')
      cargar()
    }
  }

  const prodFiltrados = productos.filter((p) => {
    if (!busquedaProd.trim()) return true
    const q = busquedaProd.toLowerCase()
    return (p.nombre ?? '').toLowerCase().includes(q) || (p.codigo ?? '').toLowerCase().includes(q)
  })

  const esEdicion = editando !== null

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-primary" />
            <h2 className="font-bold">Promociones de Volumen</h2>
          </div>
          {!esEdicion && (
            <Button size="sm" onClick={nueva}>+ Nueva</Button>
          )}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Descuentos por cantidad: 3×2, 2da al 50%, llevar X pagar Y, o % por volumen.
        </p>

        {esEdicion && (
          <div className="mb-4 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{(!editando || editando === 'new') ? 'Nueva' : 'Editando'} promoción</span>
              <button onClick={() => { setEditando(null); setForm(PROMO_VACIO) }} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">Cancelar</button>
            </div>
            <div>
              <Label>Nombre *</Label>
              <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: 3×2 Cerveza" />
            </div>
            <div>
              <Label>Tipo</Label>
              <div className="flex gap-1.5 rounded-xl bg-muted p-1">
                {TIPOS_PROMO.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setForm({ ...form, tipo: t.value as PromoForm['tipo'] })}
                    className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', form.tipo === t.value ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {form.tipo === 'lleva_paga' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Llevá (unidades)</Label>
                  <Input type="number" inputMode="numeric" value={form.lleva} onChange={(e) => setForm({ ...form, lleva: e.target.value })} placeholder="4" />
                </div>
                <div>
                  <Label>Paga (unidades)</Label>
                  <Input type="number" inputMode="numeric" value={form.paga} onChange={(e) => setForm({ ...form, paga: e.target.value })} placeholder="3" />
                </div>
              </div>
            )}
            {form.tipo === 'porcentaje' && (
              <div>
                <Label>Descuento (%)</Label>
                <Input type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="10" />
              </div>
            )}
            {form.tipo === 'monto_fijo' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Unidades requeridas</Label>
                  <Input type="number" inputMode="numeric" value={form.lleva} onChange={(e) => setForm({ ...form, lleva: e.target.value })} placeholder="3" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Ej: 3 para "3 por S/ 20"</p>
                </div>
                <div>
                  <Label>Precio fijo total (S/)</Label>
                  <Input type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="20" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Precio total del grupo</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vigencia desde</Label>
                <Input type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} />
              </div>
              <div>
                <Label>Vigencia hasta</Label>
                <Input type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Productos *</Label>
              <Input value={busquedaProd} onChange={(e) => setBusquedaProd(e.target.value)} placeholder="Buscar producto..." className="mb-2" />
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border bg-background p-2">
                {prodFiltrados.slice(0, 20).map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={form.productoIds.includes(p.id)}
                      onChange={() => toggleProd(p.id)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className="truncate">{p.nombre}</span>
                  </label>
                ))}
                {prodFiltrados.length === 0 && <p className="text-xs text-muted-foreground">Sin resultados</p>}
              </div>
              {form.productoIds.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{form.productoIds.length} producto(s) seleccionado(s)</p>}
            </div>
            <div>
              <Label>Notas (opcional)</Label>
              <Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Descripción interna" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="h-4 w-4 accent-primary" />
              Activa
            </label>
            <Button className="w-full" onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {guardando ? 'Guardando…' : 'Guardar Promoción'}
            </Button>
          </div>
        )}

        {cargando ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span>
          </div>
        ) : promos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay promociones creadas</p>
        ) : (
          <div className="space-y-2">
            {promos.map((p) => (
              <div key={p.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', p.activo ? 'bg-background' : 'bg-muted/30 opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{p.nombre}</span>
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      {TIPOS_PROMO.find((t) => t.value === p.tipo)?.label}
                    </span>
                    {!p.activo && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">Inactiva</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.productoIds.length} producto(s)
                    {p.fechaInicio && ` · Desde ${p.fechaInicio}`}
                    {p.fechaFin && ` · Hasta ${p.fechaFin}`}
                  </div>
                </div>
                <button onClick={() => editar(p)} className="text-xs font-semibold text-primary hover:underline cursor-pointer">Editar</button>
                <button onClick={() => p.id && eliminar(p.id)} className="text-destructive hover:text-destructive/80 cursor-pointer" aria-label="Eliminar">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * **Alertas proactivas** (`lib/alertas.ts` es la regla única): acá se decide **qué** se avisa y
 * **desde qué número**. ⚠️ **`0` = regla apagada** (misma convención que el tope de descuento y el
 * límite de crédito): son avisos, no candados, y **ninguno bloquea** una venta ni un cierre.
 */
function AlertasTab({ config, set }: { config: Cfg; set: <K extends keyof Cfg>(key: K, value: Cfg[K]) => void }) {
  const num = (valor: unknown) => String(valor ?? '')
  const campo = (
    clave: keyof Cfg,
    titulo: string,
    ayuda: string,
    extra: { min?: number; max?: number; paso?: number; sufijo: string; decimales?: boolean },
  ) => {
    const valor = Number(config[clave]) || 0
    return (
      <div className="rounded-lg border p-3">
        <Label className="font-medium">
          {titulo} {extra.sufijo && <span className="text-muted-foreground">({extra.sufijo})</span>}
        </Label>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{ayuda}</p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="number"
            inputMode={extra.decimales ? 'decimal' : 'numeric'}
            min={extra.min ?? 0}
            max={extra.max}
            step={extra.paso ?? 1}
            placeholder="0"
            value={num(config[clave])}
            onChange={(e) => {
              const n = Number(e.target.value) || 0
              const tope = extra.max ?? Number.POSITIVE_INFINITY
              set(clave, Math.max(extra.min ?? 0, Math.min(tope, extra.decimales ? n : Math.round(n * 100) / 100)))
            }}
            className="h-8 w-24 text-xs"
          />
          <span className="text-xs text-muted-foreground">{valor === 0 ? 'Apagada' : `Avisa desde ${valor} ${extra.sufijo}`}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="mb-1 flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />
          <h2 className="font-bold">Alertas proactivas</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Lo que ya está mal, sin que nadie tenga que ir a buscarlo: sale arriba del <b>Dashboard Gerencial</b> y se
          revisa solo cada 5 minutos (o con el botón <b>Revisar ahora</b>).{' '}
          <b>Ninguna alerta bloquea una venta, un cobro ni un cierre</b>: avisan, y el control real sigue siendo la
          persona. <b>0 = regla apagada.</b>
        </p>

        <div className="space-y-3">
          <button
            onClick={() => set('alertaStockBajo', !config.alertaStockBajo)}
            className={cn(
              'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm cursor-pointer',
              config.alertaStockBajo ? 'border-amber-300 bg-amber-50' : 'border-input',
            )}
          >
            <span>
              <span className={cn('font-medium', config.alertaStockBajo && 'text-amber-700')}>
                Avisar por stock agotado y bajo el mínimo
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                <b>Agotado</b> es una venta perdida (el cajero lo descubre con el cliente adelante) y se marca
                urgente; <b>bajo el mínimo</b> es un aviso para pedir antes de que se corte. El mínimo se carga por
                producto en Inventario: un producto con el mínimo en <b>0</b> solo puede avisar cuando se agota.
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-xs font-bold text-white',
                config.alertaStockBajo ? 'bg-amber-600' : 'bg-slate-400',
              )}
            >
              {config.alertaStockBajo ? 'SÍ' : 'NO'}
            </span>
          </button>

          {campo(
            'alertaYapeSinUsarMinutos',
            'Avisos de Yape sin usar',
            'Un aviso vencido y sin aplicar puede ser un cobro por Yape que nadie registró… o plata que no era de una venta (el Yape del negocio también recibe pagos personales). Por eso es un aviso, no una urgencia, y la salida es marcarlo como ignorado.',
            { sufijo: 'min', max: 1440 },
          )}
          {campo(
            'alertaTurnoAbiertoHoras',
            'Turno abierto demasiadas horas',
            'Un turno de un día anterior sin cerrar se avisa SIEMPRE (esa plata nunca se rindió y el arqueo del día no la ve); este número es para el turno de hoy que se quedó abierto.',
            { sufijo: 'h', max: 48 },
          )}
          {campo(
            'alertaDiferenciaCaja',
            'Diferencia de caja al cerrar',
            'Se mide sin importar el signo: un faltante y un sobrante se revisan igual. Se mira recién en los turnos YA cerrados (hasta entonces no hay contado).',
            { sufijo: 'S/', max: 1000, paso: 0.5, decimales: true },
          )}
          {campo(
            'alertaAnulacionesDia',
            'Anulaciones en el día',
            'No dice que esté mal anular: dice que hoy se anuló más de lo normal y quién lo hizo. Lo que no se puede hacer es «cuadrar» la caja anulando ventas reales (eso es un problema fiscal).',
            { sufijo: 'anulaciones', max: 100 },
          )}
          {campo(
            'alertaDescuentoPorcentaje',
            'Descuentos por encima de…',
            'Se mide sobre el BRUTO de la venta (total + descuento). Es un control distinto del tope del descuento manual de la pestaña Empresa: este mira lo que quedó registrado igual (incluidas las ventas del admin, que no pasan por ese tope). Apagado por defecto: el número lo pone el negocio.',
            { sufijo: '%', max: 100 },
          )}
        </div>
      </div>
    </div>
  )
}

function CajasTab() {
  const { toast, confirm } = useNotifications()
  const [cajas, setCajas] = React.useState<Caja[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [editando, setEditando] = React.useState<Caja | null>(null)
  const [form, setForm] = React.useState<Caja>(CAJA_POR_DEFECTO)
  const [moviendo, setMoviendo] = React.useState<string | null>(null)
  const [destino, setDestino] = React.useState('')

  React.useEffect(() => {
    cargarCajas().then(setCajas).finally(() => setCargando(false))
  }, [])

  function nueva() {
    setEditando({ ...CAJA_POR_DEFECTO, id: '__nueva__' })
    setForm({ ...CAJA_POR_DEFECTO })
  }

  function editar(c: Caja) {
    setEditando(c)
    setForm({ ...c })
  }

  async function guardar() {
    const r = await guardarCaja(form)
    if (r.success) {
      const lista = await cargarCajas()
      setCajas(lista)
      setEditando(null)
    }
  }

  async function eliminarC(id: string) {
    // ⚠️ `confirm` acá es el del sistema de notificaciones (async): el `confirm` nativo del
    // navegador quedó tapado por el destructuring y devolvía una promesa siempre "verdadera"
    // (borraba sin preguntar).
    const ok = await confirm({ title: '¿Eliminar esta caja?', message: 'No se puede deshacer.', okText: 'Eliminar' })
    if (!ok) return
    const borrado = await eliminarCaja(id)
    if (borrado) setCajas((prev) => prev.filter((c) => c.id !== id))
  }

  /**
   * Transfiere los pedidos abiertos de una caja a otra. Caso típico: una caja deja de operar y sus
   * vendedores y su cajero pasan a la otra — los pedidos que ya estaban esperando tienen que
   * seguirlos, o quedan varados sin poder cobrarse.
   */
  async function moverPedidos(c: Caja) {
    if (!c.id || !destino) return
    const destinoNombre = cajas.find((x) => x.id === destino)?.nombre || destino
    const ok = await confirm({
      title: 'Transferir pedidos abiertos',
      message: `Los pedidos que están esperando cobro en "${c.nombre}" pasan a "${destinoNombre}". Las series del comprobante las define la caja que cobra, así que no se toca ningún correlativo.`,
      okText: 'Transferir',
    })
    if (!ok) return
    const r = await moverPedidosDeCaja({ origen: c.id, destino, usuario: 'configuración' })
    if (r.success) {
      toast(r.movidos > 0 ? `✅ ${r.movidos} pedido(s) transferidos a ${destinoNombre}` : 'No había pedidos abiertos en esa caja')
      setMoviendo(null)
      setDestino('')
    } else {
      toast(`❌ ${r.error || 'No se pudieron transferir'}`, 'error')
    }
  }

  if (cargando) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  if (editando) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{editando.id === '__nueva__' ? 'Nueva Caja' : 'Editar Caja'}</h3>
          <button onClick={() => setEditando(null)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nombre</Label>
            <Input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Caja Principal" className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))} className="rounded" />
            <Label className="text-xs">Activa</Label>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-bold text-muted-foreground">Series de comprobante</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-[10px]">Boleta</Label><Input value={form.serieBoleta} onChange={(e) => setForm((f) => ({ ...f, serieBoleta: e.target.value }))} placeholder="B001" className="mt-0.5 h-8 text-xs" /></div>
              <div><Label className="text-[10px]">Factura</Label><Input value={form.serieFactura} onChange={(e) => setForm((f) => ({ ...f, serieFactura: e.target.value }))} placeholder="F001" className="mt-0.5 h-8 text-xs" /></div>
              <div><Label className="text-[10px]">NV Prefijo</Label><Input value={form.seriePrefijo} onChange={(e) => setForm((f) => ({ ...f, seriePrefijo: e.target.value }))} placeholder="NV" className="mt-0.5 h-8 text-xs" /></div>
              <div><Label className="text-[10px]">NC</Label><Input value={form.serieNC} onChange={(e) => setForm((f) => ({ ...f, serieNC: e.target.value }))} placeholder="NC" className="mt-0.5 h-8 text-xs" /></div>
              <div><Label className="text-[10px]">ND</Label><Input value={form.serieND} onChange={(e) => setForm((f) => ({ ...f, serieND: e.target.value }))} placeholder="ND" className="mt-0.5 h-8 text-xs" /></div>
              <div><Label className="text-[10px]">NCB</Label><Input value={form.serieNCB} onChange={(e) => setForm((f) => ({ ...f, serieNCB: e.target.value }))} placeholder="NCB" className="mt-0.5 h-8 text-xs" /></div>
            </div>
          </div>
        </div>
        <Button onClick={guardar} disabled={!form.nombre.trim()} className="w-full">
          <Check className="h-4 w-4 mr-1" /> Guardar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{cajas.length} caja(s) registrada(s)</p>
        <Button size="sm" onClick={nueva}>+ Nueva Caja</Button>
      </div>
      {cajas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay cajas creadas. Las cajas definen series de comprobante por terminal.</p>
      ) : (
        <div className="space-y-2">
          {cajas.map((c) => (
            <div key={c.id} className={cn('rounded-xl border bg-card p-3', !c.activo && 'opacity-50')}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{c.nombre}</span>
                    {!c.activo && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">Inactiva</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {c.serieBoleta && `B: ${c.serieBoleta}`}
                    {c.serieFactura && ` · F: ${c.serieFactura}`}
                    {c.seriePrefijo && ` · NV: ${c.seriePrefijo}`}
                  </p>
                </div>
                {cajas.length > 1 && (
                  <button onClick={() => { setMoviendo(moviendo === c.id ? null : (c.id || null)); setDestino('') }} className="text-xs font-semibold text-primary hover:underline cursor-pointer">
                    Transferir pedidos
                  </button>
                )}
                <button onClick={() => editar(c)} className="text-xs font-semibold text-primary hover:underline cursor-pointer">Editar</button>
                <button onClick={() => c.id && eliminarC(c.id)} className="text-destructive hover:text-destructive/80 cursor-pointer" aria-label="Eliminar">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {moviendo === c.id && (
                <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-2">
                  <p className="text-[11px] text-muted-foreground">
                    Los pedidos <strong>abiertos</strong> de esta caja pasan a otra. No toca series ni correlativos: el comprobante se numera con la caja que cobra.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={destino} onChange={(e) => setDestino(e.target.value)} className="h-8 min-h-[32px] flex-1 rounded-lg border border-input bg-background px-2 text-xs">
                      <option value="">Mover a…</option>
                      {cajas.filter((x) => x.id !== c.id).map((x) => (
                        <option key={x.id} value={x.id}>{x.nombre}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={() => moverPedidos(c)} disabled={!destino}>Transferir</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
