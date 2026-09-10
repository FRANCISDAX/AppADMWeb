import { CalendarDays, Loader2 } from 'lucide-react'
import * as React from 'react'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { obtenerVentasPorRango, signoDoc } from '@/services/reportes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ModalDetalleVenta } from '@/components/ModalDetalleVenta'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)
const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmtFecha = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')
// Parsea 'YYYY-MM-DD' como fecha LOCAL (no UTC), para no desplazar el día.
const parseFecha = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

type Venta = { id: string; tipoDoc?: string; serieNumero?: string; fecha?: string; turnoId?: string; venta?: { total?: number; tipoPago?: string; pagos?: { tipo?: string; monto?: number }[]; cliente_nombre?: string } }

export function ReporteFechas() {
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const miUid = tienePermiso('verTodo') ? undefined : (user?.uid || undefined)
  const [desde, setDesde] = React.useState(hoyISO())
  const [hasta, setHasta] = React.useState(hoyISO())
  const [ventas, setVentas] = React.useState<Venta[]>([])
  const [cargando, setCargando] = React.useState(false)
  const [detalle, setDetalle] = React.useState<Venta | null>(null)

  async function cargar() {
    if (!desde || !hasta) return
    setCargando(true)
    try {
      setVentas(await obtenerVentasPorRango(parseFecha(desde), parseFecha(hasta), miUid))
    } catch (e) {
      console.error('❌ Error cargando reporte por fechas:', e)
    } finally {
      setCargando(false)
    }
  }

  React.useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  if (!tienePermiso('reporteFechas')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <CalendarDays className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al Reporte por Fechas</p>
        <p className="text-xs">Pedí el permiso «reporteFechas» al administrador.</p>
      </div>
    )
  }

  const totalVentas = ventas.reduce((s, v) => s + signoDoc(v) * (v.venta?.total || 0), 0)
  const montoDe = (v: any, tipo: string) => {
    const ven = v.venta || {}
    const pagos = ven?.pagos && ven.pagos.length ? ven.pagos : (ven?.tipoPago ? [{ tipo: ven.tipoPago, monto: ven.total }] : [])
    const s = pagos.filter((p: any) => p.tipo === tipo).reduce((acc: number, p: any) => acc + (p.monto || 0), 0)
    return signoDoc(v) * s
  }
  const totalEfectivo = ventas.reduce((s, v) => s + montoDe(v, 'efectivo'), 0)
  const totalTransferencia = ventas.reduce((s, v) => s + montoDe(v, 'transferencia'), 0)
  const totalCredito = totalVentas - totalEfectivo - totalTransferencia
  const turnos = new Set(ventas.map((v) => v.turnoId).filter(Boolean)).size
  const ticketProm = ventas.length > 0 ? totalVentas / ventas.length : 0

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-extrabold">Reporte por Fechas</h1>

      {/* Selector de rango */}
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="mb-1 block">Desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1 block">Hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
          {cargando ? 'Cargando…' : 'Aplicar'}
        </Button>
      </div>

      {/* Resumen */}
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="mb-3 text-sm font-bold">📊 Resumen del período</div>
        <div className="rounded-xl bg-primary/10 p-4 text-center">
          <div className="text-xs text-muted-foreground">Total Ventas</div>
          <div className="text-2xl font-extrabold text-primary">{fmt(totalVentas)}</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-muted/60 p-3 text-center"><div className="text-xs text-muted-foreground">Turnos</div><div className="font-bold">{turnos}</div></div>
          <div className="rounded-xl bg-muted/60 p-3 text-center"><div className="text-xs text-muted-foreground">Ventas</div><div className="font-bold">{ventas.length}</div></div>
          <div className="rounded-xl bg-muted/60 p-3 text-center"><div className="text-xs text-muted-foreground">Efectivo</div><div className="font-bold text-emerald-700">{fmt(totalEfectivo)}</div></div>
          <div className="rounded-xl bg-muted/60 p-3 text-center"><div className="text-xs text-muted-foreground">Transferencia</div><div className="font-bold text-sky-700">{fmt(totalTransferencia)}</div></div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-amber-50 p-3 text-center dark:bg-amber-500/10"><div className="text-xs text-muted-foreground">💳 Crédito</div><div className="font-bold text-amber-700">{fmt(totalCredito)}</div></div>
          <div className="rounded-xl bg-muted/40 p-3 text-center"><div className="text-xs text-muted-foreground">Ticket promedio</div><div className="font-bold">{fmt(ticketProm)}</div></div>
        </div>
      </div>

      {/* Lista de ventas */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-bold">Ventas del período</span>
          <span className="num text-sm text-muted-foreground">{ventas.length} ventas</span>
        </div>
        {cargando ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span></div>
        ) : ventas.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Sin ventas en el rango</p>
        ) : (
          <div className="divide-y">
            {ventas.map((v) => {
              const pagos = v.venta?.pagos?.filter((p) => p.monto != null && p.monto > 0) ?? []
              const esMixto = pagos.length > 1
              const esNC = v.tipoDoc === 'NC'
              const esND = v.tipoDoc === 'ND'
              const tipo = v.venta?.tipoPago || 'efectivo'
              const label = esNC ? '🌱 NC' : esND ? '📈 ND' : esMixto ? '🪙 Mixto' : tipo === 'efectivo' ? '💵 Efectivo' : tipo === 'transferencia' ? '📲 Transferencia' : '💳 Crédito'
              const variant = esNC ? 'destructive' : esND ? 'secondary' : esMixto ? 'secondary' : tipo === 'efectivo' ? 'success' : tipo === 'credito' ? 'warning' : 'secondary'
              return (
                <div key={v.id} onClick={() => setDetalle(v)} className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{v.serieNumero ?? '-'}</div>
                    <div className="truncate text-xs text-muted-foreground">{fmtFecha(v.fecha)} · {v.venta?.cliente_nombre && v.venta.cliente_nombre !== '-' ? v.venta.cliente_nombre : 'Consumidor'}</div>
                  </div>
                  <Badge variant={variant as any} className="text-[10px]">{label}</Badge>
                  <span className={cn('font-bold', v.tipoDoc === 'NV' && 'text-muted-foreground', esNC && 'text-destructive')}>{esNC ? '-' : ''}{fmt(v.venta?.total ?? 0)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {detalle && (
        <ModalDetalleVenta
          venta={detalle.venta}
          serieNumero={detalle.serieNumero}
          fecha={detalle.fecha}
          tipoDoc={detalle.tipoDoc}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}
