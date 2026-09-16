import { Loader2, Trophy, Medal } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cargarProveedores } from '@/services/proveedores'

const fmt = (n: number) => 'S/ ' + (Number(n) || 0).toFixed(2)

type ProveedorScore = {
  id: string
  nombre: string
  scorePrecio: number      // 0-100: consistencia de precio (menor varianza = mejor)
  scoreVolumen: number     // 0-100: más volumen = mejor
  scoreFrecuencia: number  // 0-100: más compras = mejor relación
  scoreTotal: number
  totalGastado: number
  numCompras: number
  precioPromedio: number
  precioMin: number
  precioMax: number
  productos: number
}

function calcularScore(varianza: number, maxVarianza: number): number {
  if (maxVarianza === 0) return 100
  return Math.round(100 - (varianza / maxVarianza) * 100)
}

function calcularScoreVolumen(total: number, maxTotal: number): number {
  if (maxTotal === 0) return 0
  return Math.round((total / maxTotal) * 100)
}

export function RankingConfiabilidad() {
  const [ranking, setRanking] = React.useState<ProveedorScore[]>([])
  const [cargando, setCargando] = React.useState(true)

  React.useEffect(() => {
    Promise.all([cargarProveedores(), cargarCompras()]).then(([provs, compras]) => {
      const mapa: Record<string, { precios: number[]; total: number; compras: number; productos: Set<string> }> = {}
      for (const p of provs) {
        if (!p.id) continue
        mapa[p.id] = { precios: [], total: 0, compras: 0, productos: new Set() }
      }

      for (const c of compras) {
        const provId = c.proveedorId
        if (!provId) continue
        if (!mapa[provId]) mapa[provId] = { precios: [], total: 0, compras: 0, productos: new Set() }
        const m = mapa[provId]
        if (c.precio > 0) m.precios.push(c.precio)
        m.total += c.totalPagado
        m.compras++
        if (c.producto) m.productos.add(c.producto)
      }

      const scores: ProveedorScore[] = []
      let maxTotal = 0
      let maxVarianza = 0

      for (const [id, m] of Object.entries(mapa)) {
        if (m.compras === 0) continue
        const promedio = m.precios.length > 0 ? m.precios.reduce((s, p) => s + p, 0) / m.precios.length : 0
        const varianza = m.precios.length > 1
          ? m.precios.reduce((s, p) => s + Math.pow(p - promedio, 2), 0) / m.precios.length
          : 0
        const prov = provs.find((p) => p.id === id)
        maxTotal = Math.max(maxTotal, m.total)
        maxVarianza = Math.max(maxVarianza, varianza)
        scores.push({
          id,
          nombre: prov?.nombre || id,
          scorePrecio: 0,
          scoreVolumen: 0,
          scoreFrecuencia: 0,
          scoreTotal: 0,
          totalGastado: m.total,
          numCompras: m.compras,
          precioPromedio: promedio,
          precioMin: m.precios.length > 0 ? Math.min(...m.precios) : 0,
          precioMax: m.precios.length > 0 ? Math.max(...m.precios) : 0,
          productos: m.productos.size,
        })
      }

      const maxCompras = Math.max(...scores.map((s) => s.numCompras), 1)

      for (const s of scores) {
        const varianza = s.precioMin !== s.precioMax
          ? Math.pow(s.precioMax - s.precioMin, 2) / 4
          : 0
        s.scorePrecio = calcularScore(varianza, maxVarianza)
        s.scoreVolumen = calcularScoreVolumen(s.totalGastado, maxTotal)
        s.scoreFrecuencia = calcularScoreVolumen(s.numCompras, maxCompras)
        s.scoreTotal = Math.round(s.scorePrecio * 0.4 + s.scoreVolumen * 0.3 + s.scoreFrecuencia * 0.3)
      }

      setRanking(scores.sort((a, b) => b.scoreTotal - a.scoreTotal))
    }).catch(() => setRanking([])).finally(() => setCargando(false))
  }, [])

  async function cargarCompras() {
    const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'), orderBy('fecha', 'desc'))
    const snap = await getDocs(q)
    const result: { proveedorId: string; precio: number; totalPagado: number; producto: string }[] = []
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const meta = (data.metadata || {}) as Record<string, unknown>
      result.push({
        proveedorId: (meta.proveedorId as string) || '',
        precio: (meta.precioUnitario as number) || 0,
        totalPagado: (meta.totalPagado as number) || 0,
        producto: (data.productoNombre as string) || '',
      })
    }
    return result
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10'
    if (score >= 60) return 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
    if (score >= 40) return 'text-orange-600 bg-orange-50 dark:bg-orange-500/10'
    return 'text-red-600 bg-red-50 dark:bg-red-500/10'
  }

  const getBadge = (idx: number) => {
    if (idx === 0) return <Trophy className="h-4 w-4 text-amber-500" />
    if (idx === 1) return <Medal className="h-4 w-4 text-gray-400" />
    if (idx === 2) return <Medal className="h-4 w-4 text-amber-700" />
    return null
  }

  return (
    <div className="space-y-4">
      {/* Leyenda */}
      <div className="rounded-xl bg-muted/50 p-3 text-[11px] text-muted-foreground space-y-1">
        <p className="font-bold">Cálculo del ranking:</p>
        <p><strong className="text-foreground">Precio (40%)</strong> — Consistencia del precio entre compras (menor varianza = mejor)</p>
        <p><strong className="text-foreground">Volumen (30%)</strong> — Total gastado con el proveedor</p>
        <p><strong className="text-foreground">Frecuencia (30%)</strong> — Cantidad de compras realizadas</p>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : ranking.length === 0 ? (
        <p className="py-12 text-center text-xs text-muted-foreground">Sin datos de compras suficientes</p>
      ) : (
        <div className="space-y-3">
          {ranking.map((r, idx) => (
            <div key={r.id} className="rounded-2xl border bg-card p-4 shadow-card">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-extrabold text-primary">
                  {getBadge(idx) || (idx + 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{r.nombre}</p>
                  <p className="text-[11px] text-muted-foreground">{r.numCompras} compra{r.numCompras !== 1 ? 's' : ''} · {r.productos} producto{r.productos !== 1 ? 's' : ''}</p>
                </div>
                <div className={`rounded-xl px-3 py-1.5 text-lg font-extrabold ${getScoreColor(r.scoreTotal)}`}>
                  {r.scoreTotal}
                </div>
              </div>

              {/* Sub-scores */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground">Precio</p>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${r.scorePrecio}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] font-bold">{r.scorePrecio}/100</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground">Volumen</p>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${r.scoreVolumen}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] font-bold">{r.scoreVolumen}/100</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground">Frecuencia</p>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${r.scoreFrecuencia}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] font-bold">{r.scoreFrecuencia}/100</p>
                </div>
              </div>

              {/* Detalle */}
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Total: <strong className="text-foreground">{fmt(r.totalGastado)}</strong></span>
                <span>Precio: {fmt(r.precioMin)} – {fmt(r.precioMax)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
