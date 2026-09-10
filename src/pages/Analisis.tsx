import { AlertTriangle, Banknote, Boxes, ChevronLeft, ChevronRight, CircleDollarSign, Loader2, Package, ShoppingBag, TrendingUp, Users } from 'lucide-react'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { obtenerAnalisisMes, type AnalisisMes } from '@/services/analisis'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const PAGO_LABEL: Record<string, string> = { efectivo: '💵 Efectivo', transferencia: '📲 Transferencia', credito: '💳 Crédito' }

export function Analisis() {
  const { tienePermiso } = usePermisos()
  const { toast } = useNotifications()
  const hoy = new Date()
  const [anio, setAnio] = React.useState(hoy.getFullYear())
  const [mes, setMes] = React.useState(hoy.getMonth() + 1)
  const [tab, setTab] = React.useState<'ventas' | 'productos' | 'utilidad' | 'clientes' | 'stock'>('ventas')
  const [data, setData] = React.useState<AnalisisMes | null>(null)
  const [cargando, setCargando] = React.useState(true)

  async function cargar() {
    setCargando(true)
    try {
      const r = await obtenerAnalisisMes(anio, mes)
      setData(r)
    } catch (e) {
      console.error('❌ Error obteniendo análisis:', e)
      toast('No se pudieron cargar las estadísticas.', 'error')
    } finally {
      setCargando(false)
    }
  }

  React.useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio, mes])

  const cambiarMes = (delta: number) => {
    let m = mes + delta
    let a = anio
    if (m < 1) { m = 12; a-- }
    if (m > 12) { m = 1; a++ }
    setMes(m); setAnio(a)
  }

  if (!tienePermiso('estadisticas')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <p className="text-sm font-medium">No tenés permisos para ver Estadísticas</p>
        <p className="mt-1 text-xs">Solicitá el permiso «estadisticas» al administrador.</p>
      </div>
    )
  }

  if (cargando || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Calculando estadísticas…</span>
      </div>
    )
  }

  const k = data.kpis
  const tabs = [
    { id: 'ventas', label: 'Ventas', icon: TrendingUp },
    { id: 'productos', label: 'Productos', icon: Package },
    { id: 'utilidad', label: 'Utilidad', icon: CircleDollarSign },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'stock', label: 'Stock', icon: Boxes },
  ] as const

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Selector de mes */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-2 shadow-card">
        <Button variant="ghost" size="icon" onClick={() => cambiarMes(-1)} aria-label="Mes anterior"><ChevronLeft className="h-5 w-5" /></Button>
        <div className="text-center">
          <div className="text-sm font-extrabold">{MESES[mes - 1]} {anio}</div>
          <div className="text-[11px] text-muted-foreground">Estadísticas del período</div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => cambiarMes(1)} aria-label="Mes siguiente"><ChevronRight className="h-5 w-5" /></Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi icon={<Banknote className="h-4 w-4" />} label="Ventas" value={fmt(k.totalVentas)} />
        <Kpi icon={<ShoppingBag className="h-4 w-4" />} label="Transacciones" value={String(k.numTransacciones)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Ticket prom." value={fmt(k.ticketPromedio)} />
        <Kpi icon={<Package className="h-4 w-4" />} label="Margen bruto" value={fmt(k.margenBruto)} accent="text-emerald-600" />
        <Kpi icon={<Boxes className="h-4 w-4" />} label="Top categoría" value={k.topCategoria} />
        <Kpi icon={<Users className="h-4 w-4" />} label="Crédito" value={k.porcCredito.toFixed(1) + '%'} accent={k.porcCredito > 30 ? 'text-destructive' : ''} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1 text-sm">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-bold cursor-pointer', tab === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'ventas' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Ventas por día">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.ventasPorDia} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Line type="monotone" dataKey="total" name="Ventas" stroke="#185832" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Ventas por forma de pago">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.porTipoPago.map((p) => ({ ...p, nombre: PAGO_LABEL[p.tipo] || p.tipo }))} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="total" name="Total" radius={[6, 6, 0, 0]}>
                  {data.porTipoPago.map((_, i) => <Cell key={i} fill={['#4CAF50', '#2196F3', '#FF9800'][i % 3]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Comprobantes emitidos" className="lg:col-span-2">
            <div className="divide-y">
              {data.porTipoDoc.map((d) => (
                <div key={d.tipo} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-semibold">{d.tipo}</span>
                  <span className="text-muted-foreground">{d.count} comprobante(s) · <span className="font-bold text-foreground">{fmt(d.total)}</span></span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'productos' && (
        <Card title="Top productos por ingreso">
          <TaxTable head={['Producto', 'Cant.', 'Ingreso', 'Costo', 'Margen', '%']}>
            {data.topProductos.map((p, i) => (
              <tr key={i} className={cn(i % 2 === 1 && 'bg-muted/30')}>
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="num px-3 py-2">{p.cantidad}</td>
                <td className="num px-3 py-2">{fmt(p.ingreso)}</td>
                <td className="num px-3 py-2 text-muted-foreground">{fmt(p.costo)}</td>
                <td className="num px-3 py-2 font-bold text-emerald-600">{fmt(p.margen)}</td>
                <td className="num px-3 py-2">{p.margenPct.toFixed(0)}%</td>
              </tr>
            ))}
          </TaxTable>
          {data.topProductos.length === 0 && <Empty text="Sin ventas en el período." />}
        </Card>
      )}

      {tab === 'utilidad' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={<CircleDollarSign className="h-4 w-4" />} label="Utilidad total" value={fmt(data.utilidadProductos.reduce((s, p) => s + p.margen, 0))} accent="text-emerald-600" />
            <Kpi icon={<Package className="h-4 w-4" />} label="Productos vendidos" value={String(data.utilidadProductos.length)} />
            <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Con ganancia" value={String(data.utilidadProductos.filter((p) => p.margen > 0).length)} accent="text-emerald-600" />
            <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="En pérdida" value={String(data.utilidadProductos.filter((p) => p.margen < 0).length)} accent={data.utilidadProductos.filter((p) => p.margen < 0).length > 0 ? 'text-destructive' : ''} />
          </div>
          <Card title="Utilidad por producto (ventas del mes)">
            <TaxTable head={['Producto', 'Vendidos', 'Ingreso', 'Costo', 'Utilidad', '%']}>
              {data.utilidadProductos.map((p, i) => (
                <tr key={i} className={cn(i % 2 === 1 && 'bg-muted/30')}>
                  <td className="px-3 py-2">{p.nombre}</td>
                  <td className="num px-3 py-2">{p.cantidad}</td>
                  <td className="num px-3 py-2">{fmt(p.ingreso)}</td>
                  <td className="num px-3 py-2 text-muted-foreground">{fmt(p.costo)}</td>
                  <td className={cn('num px-3 py-2 font-bold', p.margen < 0 ? 'text-destructive' : 'text-emerald-600')}>{fmt(p.margen)}</td>
                  <td className="num px-3 py-2">{p.margenPct.toFixed(0)}%</td>
                </tr>
              ))}
            </TaxTable>
            {data.utilidadProductos.length === 0 && <Empty text="Sin ventas en el período." />}
          </Card>
        </div>
      )}

      {tab === 'clientes' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Top clientes">
            <TaxTable head={['Cliente', 'Ventas', 'Total']}>
              {data.topClientes.map((c, i) => (
                <tr key={i} className={cn(i % 2 === 1 && 'bg-muted/30')}>
                  <td className="px-3 py-2">{c.nombre}<div className="text-[10px] text-muted-foreground">{c.dni}</div></td>
                  <td className="num px-3 py-2">{c.numVentas}</td>
                  <td className="num px-3 py-2 font-bold">{fmt(c.total)}</td>
                </tr>
              ))}
            </TaxTable>
            {data.topClientes.length === 0 && <Empty text="Sin clientes en el período." />}
          </Card>
          <Card title="Morosidad (crédito pendiente)">
            {data.morosidad.length === 0 ? (
              <Empty text="Sin deudas pendientes 🎉" />
            ) : (
              <div className="divide-y">
                {data.morosidad.map((m, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span>{m.nombre}<div className="text-[10px] text-muted-foreground">{m.dni}</div></span>
                    <span className="num font-bold text-red-600">{fmt(m.saldo)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'stock' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Resumen de inventario">
            <div className="space-y-2 text-sm">
              <Row label="Valorización total" value={fmt(data.totalValorizacion)} />
              <Row label="Productos agotados" value={String(data.agotados)} />
            </div>
            <div className="mt-4">
              <div className="mb-1 text-xs font-bold text-muted-foreground">Valorización por categoría</div>
              <div className="space-y-1.5">
                {data.valorizacionPorCategoria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-32 truncate text-xs">{c.categoria}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-emerald-500" style={{ width: `${Math.max(2, (c.valor / (data.totalValorizacion || 1)) * 100)}%` }} /></div>
                    <span className="num w-20 text-right text-xs">{fmt(c.valor)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Stock bajo / a reponer">
            {data.stockBajo.length === 0 ? (
              <Empty text="Todo el stock está OK ✓" />
            ) : (
              <div className="divide-y">
                {data.stockBajo.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.nombre}</div>
                      <div className="text-[10px] text-muted-foreground">{s.codigo} · mín {s.minStock}</div>
                    </div>
                    <span className="num font-bold text-red-600">{s.stock}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="text-primary">{icon}</span>{label}</div>
      <div className={cn('num mt-1 text-xl font-extrabold', accent)}>{value}</div>
    </div>
  )
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border bg-card p-4 shadow-card', className)}>
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className="num font-bold">{value}</span></div>
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{text}</p>
}

function TaxTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">{head.map((h, i) => <th key={i} className={cn('px-3 py-2', i > 0 && 'text-right')}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
