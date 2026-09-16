import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { useAuth } from '@/context/auth'
import { buscarTurnoAbierto } from '@/services/turnos'
import { registrarPagoProveedor, obtenerPagosProveedor, type PagoProveedor } from '@/services/pagos-proveedores'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)
const fmtFecha = (iso?: string) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

type CompraItem = {
  productoNombre: string
  cantidad: number
  precioUnitario: number
}

type CompraRegistro = {
  compraId: string
  proveedor: string
  totalPagado: number
  nota: string
  fecha: string
  items: CompraItem[]
}

export function ProveedorHistorial({ proveedorId, proveedorNombre, saldoPendiente }: { proveedorId: string; proveedorNombre: string; saldoPendiente: number }) {
  const { toast } = useNotifications()
  const { user } = useAuth()
  const [compras, setCompras] = React.useState<CompraRegistro[]>([])
  const [pagos, setPagos] = React.useState<PagoProveedor[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [tab, setTab] = React.useState<'compras' | 'pagos'>('compras')
  const [pagoMonto, setPagoMonto] = React.useState('')
  const [pagoTipo, setPagoTipo] = React.useState<'efectivo' | 'transferencia' | 'yape' | 'plin'>('efectivo')
  const [pagoNota, setPagoNota] = React.useState('')
  const [pagando, setPagando] = React.useState(false)
  const [turnoId, setTurnoId] = React.useState<string | null>(null)

  React.useEffect(() => {
    buscarTurnoAbierto(user?.uid, true).then((t) => setTurnoId(t?.id ?? null))
  }, [user?.uid])

  React.useEffect(() => {
    if (!proveedorId) return
    setCargando(true)
    Promise.all([
      cargarCompras(proveedorId),
      obtenerPagosProveedor(proveedorId),
    ]).then(([c, p]) => { setCompras(c); setPagos(p) }).finally(() => setCargando(false))
  }, [proveedorId])

  async function cargarCompras(pid: string): Promise<CompraRegistro[]> {
    try {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ')
      const pidNorm = norm(pid)
      const nombreNorm = norm(proveedorNombre)

      const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
      const snap = await getDocs(q)
      const grupos: Record<string, CompraRegistro> = {}
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        const meta = (data.metadata || {}) as Record<string, unknown>
        const provId = (meta.proveedorId as string) || ''
        const provNombre = (meta.proveedor as string) || ''
        const provIdNorm = norm(provId)
        const provNombreNorm = norm(provNombre)
        const matchId = provIdNorm === pidNorm && provIdNorm !== ''
        const matchNombre = provNombreNorm === nombreNorm && provNombreNorm !== ''
        if (!matchId && !matchNombre) continue
        const compraId = (meta.compraId as string) || d.id
        if (!grupos[compraId]) {
          grupos[compraId] = { compraId, proveedor: provNombre || proveedorNombre, totalPagado: (meta.totalPagado as number) || 0, nota: (meta.nota as string) || (data.motivo as string) || '', fecha: (data.fecha as string) || '', items: [] }
        }
        grupos[compraId].items.push({ productoNombre: (data.productoNombre as string) || '', cantidad: (data.cantidad as number) || 0, precioUnitario: (meta.precioUnitario as number) || 0 })
      }
      return Object.values(grupos).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    } catch { return [] }
  }

  async function handlePago() {
    const monto = parseFloat(pagoMonto) || 0
    if (monto <= 0) { toast('Ingresa un monto válido', 'warning'); return }
    if (monto > saldoPendiente) { toast('El monto supera el saldo pendiente', 'warning'); return }
    setPagando(true)
    const r = await registrarPagoProveedor(proveedorId, { monto, tipoPago: pagoTipo, nota: pagoNota }, turnoId)
    setPagando(false)
    if (r.success) {
      toast('Pago registrado', 'success')
      setPagoMonto('')
      setPagoNota('')
      const p = await obtenerPagosProveedor(proveedorId)
      setPagos(p)
    } else {
      toast(r.error || 'Error', 'error')
    }
  }

  return (
    <div className="space-y-3">
      {/* Saldo */}
      <div className="flex items-center justify-between rounded-xl border p-3">
        <span className="text-sm font-semibold">Saldo pendiente</span>
        <span className={`text-lg font-extrabold ${saldoPendiente > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(saldoPendiente)}</span>
      </div>

      {/* Registrar pago */}
      {saldoPendiente > 0 && (
        <div className="rounded-xl border p-3 space-y-2">
          <p className="text-xs font-bold text-muted-foreground">Registrar pago</p>
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} placeholder="Monto S/" className="h-9 flex-1 rounded-lg border px-2 text-sm" />
            <select value={pagoTipo} onChange={(e) => setPagoTipo(e.target.value as typeof pagoTipo)} className="h-9 rounded-lg border px-2 text-xs">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="yape">Yape</option>
              <option value="plin">Plin</option>
            </select>
          </div>
          <input value={pagoNota} onChange={(e) => setPagoNota(e.target.value)} placeholder="Nota (opcional)" className="h-9 w-full rounded-lg border px-2 text-xs" />
          <Button size="sm" onClick={handlePago} disabled={pagando} className="w-full">
            {pagando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {pagando ? 'Procesando…' : 'Registrar pago'}
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs">
        <button onClick={() => setTab('compras')} className={`flex-1 rounded-lg py-1.5 font-bold cursor-pointer ${tab === 'compras' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
          Compras ({compras.length})
        </button>
        <button onClick={() => setTab('pagos')} className={`flex-1 rounded-lg py-1.5 font-bold cursor-pointer ${tab === 'pagos' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
          Pagos ({pagos.length})
        </button>
      </div>

      {cargando && (
        <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      )}

      {!cargando && tab === 'compras' && (
        <div className="space-y-2">
          {compras.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Sin compras registradas</p>
          ) : compras.map((c) => (
            <div key={c.compraId} className="rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">{fmtFecha(c.fecha)}</span>
                <span className="text-sm font-extrabold">{fmt(c.totalPagado)}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.items.length} producto{c.items.length !== 1 ? 's' : ''}</p>
              {c.nota && <p className="mt-0.5 text-[11px] text-muted-foreground">📝 {c.nota}</p>}
            </div>
          ))}
        </div>
      )}

      {!cargando && tab === 'pagos' && (
        <div className="space-y-2">
          {pagos.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Sin pagos registrados</p>
          ) : pagos.map((p, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <span className="text-xs font-bold">{fmtFecha(p.fecha)}</span>
                {p.nota && <p className="text-[11px] text-muted-foreground">{p.nota}</p>}
              </div>
              <div className="text-right">
                <span className="text-sm font-extrabold text-emerald-600">-{fmt(p.monto)}</span>
                <p className="text-[10px] text-muted-foreground capitalize">{p.tipoPago}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
