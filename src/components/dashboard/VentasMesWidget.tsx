import { TrendingUp } from 'lucide-react'

const fmtC = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const mesActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Props = {
  totalVentasMes: number
  ventasMesCount: number
  mesNombre: string
  serieDiaria: {
    dias: { key: string; label: string; date: Date }[]
    tot: Record<string, number>
    max: number
    step: number
  }
  mes: string
  onMesChange: (mes: string) => void
}

export function VentasMesWidget({ totalVentasMes, ventasMesCount, mesNombre, serieDiaria, mes, onMesChange }: Props) {
  return (
    <>
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Total Ventas del Mes</div>
            <div className="text-2xl font-extrabold">{fmtC(totalVentasMes)}</div>
            <div className="text-[11px] text-muted-foreground">{ventasMesCount} comprobantes</div>
          </div>
          <input
            type="month"
            value={mes}
            max={mesActual()}
            onChange={(e) => e.target.value && onMesChange(e.target.value)}
            className="h-10 rounded-lg border px-3 text-sm"
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="font-bold">Ventas Diarias · {mesNombre}</h3>
        </div>
        <div className="flex h-44 items-end gap-[2px]">
          {serieDiaria.dias.map((d, i) => {
            const v = serieDiaria.tot[d.key] || 0
            const h = Math.max(3, (v / serieDiaria.max) * 100)
            const showLabel = i % serieDiaria.step === 0 || i === serieDiaria.dias.length - 1
            return (
              <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full rounded-t bg-primary/85"
                  style={{ height: `${h}%` }}
                  title={`${d.date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}: ${fmtC(v)}`}
                />
                <span className="h-4 text-[9px] font-semibold text-muted-foreground">
                  {showLabel ? d.label : ''}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
