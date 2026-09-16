import { Trophy, TrendingUp, ShoppingBag, Calendar } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmt } from '@/lib/ui-utils'
import { obtenerTodosLosClientes, type Cliente } from '@/services/clientes'

type ClienteRanking = Cliente & {
  score: number
  posicion?: number
}

function calcularScore(c: Cliente): number {
  const compras = c.totalCompras ?? 0
  const monto = c.montoTotal ?? 0

  // Recencia: días desde la última compra (menos días = mejor)
  let recencia = 999
  if (c.ultimaCompra) {
    const diff = Date.now() - new Date(c.ultimaCompra).getTime()
    recencia = Math.floor(diff / (1000 * 60 * 60 * 24))
  }

  // Normalizar cada métrica (0-100)
  const scoreCompras = Math.min(compras / 50, 1) * 100 // 50 compras = máximo
  const scoreMonto = Math.min(monto / 10000, 1) * 100 // S/ 10,000 = máximo
  const scoreRecencia = Math.max(0, 100 - recencia) // 0 días = 100, 100+ días = 0

  // Ponderación: 40% compras, 40% monto, 20% recencia
  return Math.round(scoreCompras * 0.4 + scoreMonto * 0.4 + scoreRecencia * 0.2)
}

function diasDesde(fecha?: string | null): string {
  if (!fecha) return 'Nunca'
  const diff = Date.now() - new Date(fecha).getTime()
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 7) return `Hace ${dias} días`
  if (dias < 30) return `Hace ${Math.floor(dias / 7)} sem`
  return `Hace ${Math.floor(dias / 30)} mes`
}

const MEDALLAS = [
  { emoji: '🥇', color: 'text-yellow-500' },
  { emoji: '🥈', color: 'text-gray-400' },
  { emoji: '🥉', color: 'text-amber-600' },
]

export function RankingClientes() {
  const [clientes, setClientes] = React.useState<ClienteRanking[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [criterio, setCriterio] = React.useState<'score' | 'monto' | 'compras'>('score')

  React.useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const lista = await obtenerTodosLosClientes()
        const conScore = lista
          .filter((c) => (c.totalCompras ?? 0) > 0)
          .map((c) => ({ ...c, score: calcularScore(c) }))
        if (activo) setClientes(conScore)
      } catch (e) {
        console.error('Error cargando ranking:', e)
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [])

  const ranking = React.useMemo(() => {
    const sorted = [...clientes]
    if (criterio === 'monto') sorted.sort((a, b) => (b.montoTotal ?? 0) - (a.montoTotal ?? 0))
    else if (criterio === 'compras') sorted.sort((a, b) => (b.totalCompras ?? 0) - (a.totalCompras ?? 0))
    else sorted.sort((a, b) => b.score - a.score)
    return sorted.slice(0, 10).map((c, i) => ({ ...c, posicion: i + 1 }))
  }, [clientes, criterio])

  const maxValor = React.useMemo(() => {
    if (ranking.length === 0) return 1
    if (criterio === 'monto') return ranking[0].montoTotal ?? 1
    if (criterio === 'compras') return ranking[0].totalCompras ?? 1
    return ranking[0].score || 1
  }, [ranking, criterio])

  if (cargando) {
    return (
      <div className="rounded-2xl border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4 animate-pulse" /> Cargando ranking...
        </div>
      </div>
    )
  }

  if (ranking.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="h-5 w-5 text-primary" />
          <span className="font-bold">Clientes Frecuentes</span>
        </div>
        <p className="text-sm text-muted-foreground">Aún no hay clientes con compras registradas.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-card shadow-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <span className="font-bold">Clientes Frecuentes</span>
          <Badge variant="secondary" className="text-[10px]">{ranking.length}</Badge>
        </div>
      </div>

      {/* Filtro de criterio */}
      <div className="flex gap-1 border-b px-4 py-2">
        {([
          { key: 'score' as const, label: '🏆 Score', icon: Trophy },
          { key: 'monto' as const, label: '💰 Monto', icon: TrendingUp },
          { key: 'compras' as const, label: '🛒 Compras', icon: ShoppingBag },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setCriterio(key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
              criterio === key ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="divide-y divide-border/60">
        {ranking.map((c) => {
          const valor = criterio === 'monto' ? (c.montoTotal ?? 0) : criterio === 'compras' ? (c.totalCompras ?? 0) : c.score
          const porcentaje = Math.round((valor / maxValor) * 100)
          const esTop3 = c.posicion <= 3
          return (
            <div key={c.id || c.numeroDoc} className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40', esTop3 && 'bg-primary/5')}>
              {/* Posición */}
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold', esTop3 ? '' : 'bg-muted text-muted-foreground')}>
                {esTop3 ? (
                  <span className={cn('text-lg', MEDALLAS[c.posicion - 1].color)}>{MEDALLAS[c.posicion - 1].emoji}</span>
                ) : (
                  <span className="text-xs">{c.posicion}°</span>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn('truncate text-sm font-semibold', esTop3 && 'text-foreground')}>
                    {c.razonSocial || c.nombre || c.numeroDoc || 'Sin nombre'}
                  </span>
                  {c.creditoActivo && <Badge variant="warning" className="text-[9px]">CRÉDITO</Badge>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{c.totalCompras ?? 0} compras</span>
                  <span>{fmt(c.montoTotal ?? 0)}</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {diasDesde(c.ultimaCompra)}
                  </span>
                </div>
                {/* Barra de progreso */}
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', esTop3 ? 'bg-primary' : 'bg-primary/60')}
                    style={{ width: `${porcentaje}%` }}
                  />
                </div>
              </div>

              {/* Valor */}
              <div className="text-right">
                <div className={cn('text-sm font-bold', esTop3 ? 'text-primary' : 'text-foreground')}>
                  {criterio === 'monto' ? fmt(valor) : criterio === 'compras' ? String(valor) : `${valor}`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {criterio === 'score' ? 'pts' : criterio === 'monto' ? 'total' : 'veces'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
