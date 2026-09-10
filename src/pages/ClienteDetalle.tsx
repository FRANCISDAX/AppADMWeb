import { ArrowLeft, BadgeCheck, Loader2, Pen, Search, Wallet } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { actualizarCliente, crearOCargarCliente, obtenerCliente, obtenerVentasDelCliente, registrarCobro, actualizarSaldoCredito, validarSunatCliente, type Cliente } from '@/services/clientes'
import { useNotifications } from '@/components/notifications'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { buscarTurnoAbierto } from '@/services/turnos'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)
const fmtFecha = (iso?: string) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const mesActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function filtrarPorMes(docs: VentaDoc[], mes: string): VentaDoc[] {
  if (!mes) return docs
  return docs.filter((v) => {
    const fecha = v.fecha || v.createdAt || ''
    return fecha.startsWith(mes)
  })
}

type Form = { razonSocial: string; tipoDoc: string; numeroDoc: string; direccion: string; email: string; telefono: string; tipoDocDefecto: string; listaPrecio: string; creditoActivo: boolean; limiteCredito: number; diasCredito: number; notas: string }
const VACIO: Form = { razonSocial: '', tipoDoc: 'dni', numeroDoc: '', direccion: '', email: '', telefono: '', tipoDocDefecto: 'boleta', listaPrecio: 'general', creditoActivo: false, limiteCredito: 0, diasCredito: 0, notas: '' }

type VentaItem = { id?: string; nombre?: string; cantidad?: number; unidad?: string; precioVenta?: number; subtotal?: number }
type VentaDoc = { id: string; serieNumero?: string; createdAt?: string; fecha?: string; venta?: { total?: number; tipoPago?: string; cobrado?: number; pagos?: any[]; fecha?: string; serie_numero?: string; cliente_nombre?: string; items?: VentaItem[] }; sunat?: { estado?: string } }

export function ClienteDetalle({ clave, nuevo, onBack }: { clave?: string; nuevo?: boolean; onBack: () => void }) {
  const esNuevo = !!nuevo && !clave
  const { toast } = useNotifications()
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const [cliente, setCliente] = React.useState<Cliente | null>(null)
  const [editando, setEditando] = React.useState(esNuevo)
  const [cargando, setCargando] = React.useState(true)
  const [guardando, setGuardando] = React.useState(false)
  const [consultandoSunat, setConsultandoSunat] = React.useState(false)
  const [numDocInput, setNumDocInput] = React.useState('')
  const [form, setForm] = React.useState<Form>(VACIO)
  const [ventas, setVentas] = React.useState<VentaDoc[]>([])
  const [mesFiltro, setMesFiltro] = React.useState(mesActual())
  const [cobroDoc, setCobroDoc] = React.useState<VentaDoc | null>(null)
  const [cobroMonto, setCobroMonto] = React.useState('')
  const [cobroTipo, setCobroTipo] = React.useState('efectivo')
  const [cobrando, setCobrando] = React.useState(false)
  const [detalleVenta, setDetalleVenta] = React.useState<VentaDoc | null>(null)

  // Ventas filtradas por mes seleccionado
  const ventasFiltradas = React.useMemo(() => filtrarPorMes(ventas, mesFiltro), [ventas, mesFiltro])

  // Historial de pagos: extrae todos los pagos de todas las ventas filtradas (DEBE ir antes del early return)
  const pagosHistorial = React.useMemo(() => {
    const pagos: { fecha: string; monto: number; tipoPago: string; serieNumero: string; ventaTotal: number }[] = []
    for (const v of ventasFiltradas) {
      const ven = v.venta || {}
      if (Array.isArray(ven.pagos)) {
        for (const p of ven.pagos) {
          pagos.push({
            fecha: p.fecha || '',
            monto: p.monto || 0,
            tipoPago: p.tipoPago || ven.tipoPago || 'efectivo',
            serieNumero: v.serieNumero || v.id,
            ventaTotal: ven.total || 0,
          })
        }
      }
    }
    return pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  }, [ventasFiltradas])

  const cargar = React.useCallback(async (id: string) => {
    setCargando(true)
    const c = await obtenerCliente(id)
    if (c) {
      setCliente(c)
      setForm({
        razonSocial: c.razonSocial ?? '', tipoDoc: c.tipoDoc ?? 'dni', numeroDoc: c.numeroDoc ?? '',
        direccion: c.direccion ?? '', email: c.email ?? '', telefono: c.telefono ?? '',
        tipoDocDefecto: c.tipoDocDefecto ?? 'boleta', listaPrecio: c.listaPrecio ?? 'general',
        creditoActivo: !!c.creditoActivo, limiteCredito: c.limiteCredito ?? 0, diasCredito: c.diasCredito ?? 0, notas: c.notas ?? '',
      })
      setVentas(await obtenerVentasDelCliente(id, 15))
    }
    setCargando(false)
  }, [])

  React.useEffect(() => {
    if (clave) cargar(clave)
    else setCargando(false)
  }, [clave, cargar])

  async function handleBuscarSunat() {
    const num = numDocInput.trim()
    if (!num || (num.length !== 8 && num.length !== 11)) { toast('DNI debe tener 8 dígitos, RUC 11', 'warning'); return }
    setGuardando(true)
    const r = await crearOCargarCliente(num)
    if (r.success && r.cliente) {
      setCliente(r.cliente)
      setEditando(false)
      setNumDocInput('')
      toast(`${r.creado ? 'Cliente creado' : 'Cliente encontrado'}: ${r.cliente.razonSocial || 'OK'}`, 'success')
      cargar(r.cliente.id as string)
    } else {
      toast(r.error || 'No se pudo consultar SUNAT', 'error')
    }
    setGuardando(false)
  }

  async function handleGuardar() {
    if (!form.razonSocial.trim()) { toast('El nombre es obligatorio', 'warning'); return }
    setGuardando(true)
    if (esNuevo && !cliente) {
      const id = form.numeroDoc.trim() || Date.now().toString()
      const r = await crearOCargarCliente(id)
      if (r.success && r.cliente) {
        await actualizarCliente(r.cliente.id as string, form)
        toast('Cliente creado correctamente', 'success')
        setCliente(r.cliente)
        setEditando(false)
        cargar(r.cliente.id as string)
      } else {
        toast(r.error || 'Error', 'error')
      }
    } else if (cliente) {
      const r = await actualizarCliente(cliente.id as string, form)
      if (r.success) { setEditando(false); toast('Datos actualizados', 'success'); cargar(cliente.id as string) }
      else toast(r.error || 'Error', 'error')
    }
    setGuardando(false)
  }

  async function handleValidarSunat() {
    if (!cliente) return
    setConsultandoSunat(true)
    const r = await validarSunatCliente(cliente.id as string)
    if (r) { toast(`Validación SUNAT\nEstado: ${r.estado}\nVálido: ${r.valido ? 'Sí' : 'No'}`, r.valido ? 'success' : 'warning'); cargar(cliente.id as string) }
    else toast('No se pudo validar en SUNAT', 'error')
    setConsultandoSunat(false)
  }

  async function handleCobrar() {
    if (!cobroDoc || cobrando) return
    const monto = parseFloat(cobroMonto)
    if (!(monto > 0)) { toast('Ingresa un monto válido', 'warning'); return }
    setCobrando(true)
    try {
      const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
      if (!turno) { toast('🚫 No hay un turno abierto. Abrí un turno antes de cobrar.', 'error'); return }
      const r = await registrarCobro(cobroDoc.id, monto, cobroTipo, turno.id)
      if (r.success) {
        if (cliente) await actualizarSaldoCredito(cliente.id as string)
        setCobroDoc(null); setCobroMonto('')
        toast('Cobro registrado', 'success')
        if (cliente) cargar(cliente.id as string)
      } else {
        toast(r.error || 'Error', 'error')
      }
    } finally {
      setCobrando(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span>
      </div>
    )
  }

  const setF = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => ({ ...p, [k]: v }))

  const renderForm = () => (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="space-y-3">
        <div>
          <Label>Razón Social *</Label>
          <Input value={form.razonSocial} onChange={(e) => setF('razonSocial', e.target.value)} placeholder="Nombre / Razón social" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo de documento</Label>
            <div className="flex gap-1.5 rounded-xl bg-muted p-1">
              {['dni', 'ruc'].map((k) => (
                <button key={k} onClick={() => setF('tipoDoc', k)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', form.tipoDoc === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Número de documento</Label>
            <Input value={form.numeroDoc} onChange={(e) => setF('numeroDoc', e.target.value)} inputMode="numeric" maxLength={11} />
          </div>
        </div>
        <Input value={form.direccion} onChange={(e) => setF('direccion', e.target.value)} placeholder="Dirección" />
        <div className="grid grid-cols-2 gap-3">
          <Input value={form.email} onChange={(e) => setF('email', e.target.value)} placeholder="Email" type="email" />
          <Input value={form.telefono} onChange={(e) => setF('telefono', e.target.value)} placeholder="Teléfono" />
        </div>

        <div>
          <Label className="mb-1 block">Preferencias</Label>
          <div className="flex gap-1.5 rounded-xl bg-muted p-1">
            {['boleta', 'factura'].map((k) => (
              <button key={k} onClick={() => setF('tipoDocDefecto', k)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', form.tipoDocDefecto === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
                {k === 'boleta' ? '🧾 Boleta' : '📄 Factura'}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5 rounded-xl bg-muted p-1">
            {['general', 'mayorista', 'preferencial'].map((k) => (
              <button key={k} onClick={() => setF('listaPrecio', k)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', form.listaPrecio === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-1 block">Crédito</Label>
          <button onClick={() => setF('creditoActivo', !form.creditoActivo)} className={cn('flex w-full items-center justify-between rounded-lg border p-3 text-sm cursor-pointer', form.creditoActivo ? 'border-emerald-300 bg-emerald-50' : 'border-input')}>
            <span className={cn('font-medium', form.creditoActivo && 'text-emerald-700')}>{form.creditoActivo ? '✔ Crédito activo' : '✖ Crédito desactivado'}</span>
            <span className={cn('rounded-md px-2.5 py-1 text-xs font-bold text-white', form.creditoActivo ? 'bg-emerald-600' : 'bg-slate-400')}>{form.creditoActivo ? 'SÍ' : 'NO'}</span>
          </button>
          {form.creditoActivo && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <Label>Límite de crédito (S/)</Label>
                <Input value={form.limiteCredito ? String(form.limiteCredito) : ''} onChange={(e) => setF('limiteCredito', parseFloat(e.target.value) || 0)} inputMode="numeric" />
              </div>
              <div>
                <Label>Días de crédito</Label>
                <Input value={form.diasCredito ? String(form.diasCredito) : ''} onChange={(e) => setF('diasCredito', parseInt(e.target.value) || 0)} inputMode="numeric" />
              </div>
            </div>
          )}
        </div>

        <Input value={form.notas} onChange={(e) => setF('notas', e.target.value)} placeholder="Notas" />

        <Button className="w-full" size="lg" onClick={handleGuardar} disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  )

  const pendientes = ventas.filter((v) => v.venta?.tipoPago === 'credito' && (v.venta.total ?? 0) - (v.venta.cobrado ?? 0) > 0)
  const saldo = cliente?.saldoPendiente ?? 0
  const limite = cliente?.limiteCredito ?? 0

  const renderVista = () => {
    if (!cliente) return null
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border bg-card p-5 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-extrabold">{cliente.razonSocial || 'Sin nombre'}</div>
              <div className="text-sm text-muted-foreground">{String(cliente.tipoDoc || '').toUpperCase()}: {cliente.numeroDoc}</div>
            </div>
            <Button variant="outline" size="icon" onClick={() => setEditando(true)}><Pen className="h-4 w-4" /></Button>
          </div>
          {cliente.direccion && <div className="mt-1 text-sm text-muted-foreground">📍 {cliente.direccion}</div>}
          {cliente.email && <div className="text-sm text-muted-foreground">✉ {cliente.email}</div>}
          {cliente.telefono && <div className="text-sm text-muted-foreground">📞 {cliente.telefono}</div>}

          <div className="mt-3 flex items-center gap-2">
            <Badge variant="secondary" className="uppercase">{cliente.frecuencia || 'ocasional'}</Badge>
            <Button variant="outline" size="sm" className="text-sky-600" onClick={handleValidarSunat} disabled={consultandoSunat}>
              {consultandoSunat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
              {cliente.sunatValido ? '✔ SUNAT' : 'Validar SUNAT'}
            </Button>
          </div>

          {cliente.creditoActivo && (
            <div className="mt-3 rounded-xl bg-muted/60 p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><div className="text-[11px] text-muted-foreground">Límite</div><div className="font-bold">{fmt(limite)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Saldo</div><div className={cn('font-bold', saldo > 0 && 'text-red-600')}>{fmt(saldo)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Disponible</div><div className={cn('font-bold', limite - saldo < 0 ? 'text-red-600' : 'text-emerald-600')}>{fmt(limite - saldo)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Días</div><div className="font-bold">{cliente.diasCredito ?? 0}</div></div>
              </div>
            </div>
          )}

          {(cliente.totalCompras ?? 0) > 0 && (
            <div className="mt-2 text-xs italic text-muted-foreground">🛒 Total compras: {fmt(cliente.totalCompras ?? 0)} · Última: {fmtFecha(cliente.ultimaCompra ?? undefined)}</div>
          )}
        </div>

        {/* Cuentas por cobrar */}
        {pendientes.length > 0 && (
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center">
              <h3 className="font-bold">Cuentas por Cobrar</h3>
              <Badge variant="destructive" className="ml-2">{pendientes.length}</Badge>
            </div>
            <div className="divide-y">
              {pendientes.map((v) => {
                const total = v.venta?.total ?? 0
                const cobrado = v.venta?.cobrado ?? 0
                const pend = total - cobrado
                return (
                  <div key={v.id} className="flex items-center gap-3 py-2.5">
                    <button onClick={() => setDetalleVenta(v)} className="min-w-0 flex-1 text-left cursor-pointer">
                      <div className="text-sm font-semibold">{v.serieNumero || v.id}</div>
                      <div className="text-xs text-muted-foreground">{fmtFecha(v.createdAt || v.fecha)} · {v.venta?.tipoPago}</div>
                    </button>
                    <div className="text-right">
                      <div className="text-sm font-bold text-red-600">{fmt(pend)}</div>
                      <div className="text-[11px] text-muted-foreground">de {fmt(total)}</div>
                    </div>
                    <Button variant="outline" size="sm" disabled={cobrando} onClick={() => { setCobroDoc(v); setCobroMonto(String(pend)) }}>Cobrar</Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Filtro de mes */}
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold">Período:</label>
            <input
              type="month"
              value={mesFiltro}
              onChange={(e) => setMesFiltro(e.target.value)}
              className="rounded-lg border bg-background px-3 py-1.5 text-sm"
            />
            <span className="text-xs text-muted-foreground">{ventasFiltradas.length} venta{ventasFiltradas.length !== 1 ? 's' : ''} en este mes</span>
          </div>
        </div>

        {/* Historial de pagos */}
        {pagosHistorial.length > 0 && (
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">Historial de Pagos</h3>
              <Badge variant="secondary">{pagosHistorial.length}</Badge>
            </div>
            <div className="mb-3 rounded-xl bg-muted/60 p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[11px] text-muted-foreground">Total cobrado</div>
                  <div className="font-bold text-emerald-600">{fmt(pagosHistorial.reduce((s, p) => s + p.monto, 0))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Pagos realizados</div>
                  <div className="font-bold">{pagosHistorial.length}</div>
                </div>
              </div>
            </div>
            <div className="divide-y">
              {pagosHistorial.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
                    <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{fmt(p.monto)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.serieNumero} · {fmtFecha(p.fecha)}
                    </div>
                  </div>
                  <Badge variant={p.tipoPago === 'efectivo' ? 'success' : p.tipoPago === 'transferencia' ? 'secondary' : 'warning'} className="text-[10px]">
                    {p.tipoPago === 'efectivo' ? '💵 Efectivo' : p.tipoPago === 'transferencia' ? '📲 Transferencia' : p.tipoPago === 'yape' ? '📱 Yape' : p.tipoPago === 'plin' ? '📱 Plin' : p.tipoPago}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Últimas ventas */}
        {ventasFiltradas.length > 0 && (
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <h3 className="mb-3 font-bold">Últimas ventas</h3>
            <div className="divide-y">
              {ventasFiltradas.map((v, i) => {
                const ven = v.venta || {}
                return (
                  <button key={v.id || i} onClick={() => setDetalleVenta(v)} className="flex w-full items-center gap-3 py-2.5 text-left cursor-pointer hover:bg-muted/40 rounded-lg px-2 -mx-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">{fmtFecha(v.createdAt || ven.fecha)}</div>
                      <div className="text-sm font-semibold">{v.serieNumero || '-'}</div>
                      <div className="mt-0.5 flex gap-1.5">
                        <Badge variant={ven.tipoPago === 'credito' ? 'warning' : 'success'} className="text-[10px]">{ven.tipoPago === 'credito' ? 'Crédito' : ven.tipoPago === 'transferencia' ? 'Transferencia' : ven.tipoPago || '-'}</Badge>
                        {v.sunat?.estado && <Badge variant={v.sunat.estado === 'aceptado' ? 'success' : v.sunat.estado === 'rechazado' ? 'destructive' : 'warning'} className="text-[10px]">{v.sunat.estado}</Badge>}
                      </div>
                    </div>
                    <div className="text-sm font-bold">{fmt(ven.total ?? 0)}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-extrabold">{esNuevo ? 'Nuevo Cliente' : 'Detalle del Cliente'}</h1>
      </div>

      {esNuevo && !cliente && (
        <div className="rounded-2xl border bg-card p-5 shadow-card">
          <Label className="mb-1 block">Buscar por DNI/RUC (autocompletado desde SUNAT)</Label>
          <div className="flex gap-2">
            <Input value={numDocInput} onChange={(e) => setNumDocInput(e.target.value)} placeholder="DNI (8) o RUC (11)" inputMode="numeric" maxLength={11} />
            <Button onClick={handleBuscarSunat} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar</Button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">— o ingresa los datos manualmente —</p>
        </div>
      )}

      {editando || esNuevo ? renderForm() : renderVista()}

      {/* Modal detalle de venta */}
      {detalleVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Detalle de la venta</h2>
              <button onClick={() => setDetalleVenta(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <div className="mb-3 rounded-xl bg-muted/60 p-3">
              <div className="font-bold">{detalleVenta.venta?.serie_numero || detalleVenta.serieNumero || detalleVenta.id}</div>
              <div className="text-xs text-muted-foreground">{fmtFecha(detalleVenta.createdAt || detalleVenta.venta?.fecha)} · Cliente: {detalleVenta.venta?.cliente_nombre || '-'}</div>
            </div>
            <div className="divide-y rounded-xl border">
              {(detalleVenta.venta?.items || []).length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">Sin detalle de ítems</p>
              ) : (detalleVenta.venta?.items || []).map((it, i) => {
                const cant = Number(it.cantidad) || 0
                const precio = Number(it.precioVenta) || 0
                const subtotal = Number(it.subtotal) || (cant * precio)
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{it.nombre || '-'}</div>
                      <div className="text-xs text-muted-foreground">{cant} × {fmt(precio)}{it.unidad ? ' ' + it.unidad : ''}</div>
                    </div>
                    <div className="ml-2 font-bold">{fmt(subtotal)}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Badge variant={detalleVenta.venta?.tipoPago === 'credito' ? 'warning' : 'success'}>{detalleVenta.venta?.tipoPago === 'credito' ? '💳 Crédito' : detalleVenta.venta?.tipoPago === 'transferencia' ? '📲 Transferencia' : '💵 Efectivo'}</Badge>
              <span className="text-lg font-extrabold">{fmt(detalleVenta.venta?.total ?? 0)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal cobro */}
      {cobroDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Registrar Cobro</h2>
              <button onClick={() => setCobroDoc(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">Documento {cobroDoc.serieNumero || cobroDoc.id}. Pendiente: <span className="font-bold text-red-600">{fmt((cobroDoc.venta?.total ?? 0) - (cobroDoc.venta?.cobrado ?? 0))}</span></p>
            <div className="space-y-3">
              <div>
                <Label>Monto</Label>
                <Input value={cobroMonto} onChange={(e) => setCobroMonto(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <Label>Tipo de pago</Label>
                <div className="flex gap-1.5 rounded-xl bg-muted p-1">
                  {['efectivo', 'transferencia', 'yape', 'plin'].map((k) => (
                    <button key={k} onClick={() => setCobroTipo(k)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', cobroTipo === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>{k}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setCobroDoc(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={handleCobrar} disabled={cobrando}>
                  {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {cobrando ? 'Cobrando…' : 'Confirmar cobro'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
