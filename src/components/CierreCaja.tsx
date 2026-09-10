import { AlertTriangle, CheckCircle, Info, Loader2, Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { analizarCierre, type ResultadoAuditoria } from '@/lib/auditoria-caja'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

type Props = {
  turno: {
    montoInicial: number
    totalEfectivo: number
    totalGastosEfectivo: number
    ventasDelTurno: any[]
  }
  onConfirm: (montoFinal: number, observaciones: string) => Promise<void>
  onCancel: () => void
  procesando: boolean
}

export function CierreCaja({ turno, onConfirm, onCancel, procesando }: Props) {
  const [montoFinal, setMontoFinal] = React.useState('')
  const [observaciones, setObservaciones] = React.useState('')
  const [paso, setPaso] = React.useState<'conteo' | 'analisis'>('conteo')
  const [resultado, setResultado] = React.useState<ResultadoAuditoria | null>(null)

  const monto = parseFloat(montoFinal) || 0

  function handleAnalizar() {
    if (monto <= 0) return
    const r = analizarCierre({
      montoInicial: turno.montoInicial,
      totalEfectivo: turno.totalEfectivo,
      totalGastosEfectivo: turno.totalGastosEfectivo || 0,
      ventasDelTurno: turno.ventasDelTurno || [],
      efectivoReal: monto,
    })
    setResultado(r)
    setPaso('analisis')
  }

  async function handleConfirmar() {
    await onConfirm(monto, observaciones)
  }

  if (paso === 'analisis' && resultado) {
    const diffAbs = Math.abs(resultado.diferencia)
    const esSobrante = resultado.diferencia > 0
    const cuadra = diffAbs < 0.01

    return (
      <div className="space-y-4">
        <div className={cn(
          'rounded-xl border p-4 text-center',
          cuadra ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950' :
          esSobrante ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950' :
          'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950'
        )}>
          {cuadra ? (
            <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
          ) : (
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-600" />
          )}
          <div className="text-sm text-muted-foreground">
            {cuadra ? '✅ Caja cuadrada' : esSobrante ? '⚠️ Sobrante' : '🔴 Faltante'}
          </div>
          <div className={cn('mt-1 text-2xl font-extrabold', cuadra ? 'text-emerald-700' : 'text-red-700')}>
            {cuadra ? 'S/ 0.00' : fmt(resultado.diferencia)}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-muted-foreground">Esperado</div>
            <div className="font-bold">{fmt(resultado.efectivoEsperado)}</div>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-muted-foreground">Contado</div>
            <div className="font-bold">{fmt(resultado.efectivoReal)}</div>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-muted-foreground">Diferencia</div>
            <div className={cn('font-bold', cuadra ? 'text-emerald-600' : 'text-red-600')}>
              {cuadra ? 'S/ 0.00' : fmt(resultado.diferencia)}
            </div>
          </div>
        </div>

        {resultado.causas.length > 0 && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Search className="h-3.5 w-3.5" /> Posibles causas
            </h4>
            <div className="space-y-1.5">
              {resultado.causas.map((c, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950">
                  <span className="font-semibold text-amber-700 dark:text-amber-300">{c.descripcion}</span>
                  {c.hora && <span className="ml-1 text-muted-foreground">— {c.hora}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {resultado.recomendaciones.length > 0 && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Info className="h-3.5 w-3.5" /> Recomendaciones
            </h4>
            <ul className="space-y-1">
              {resultado.recomendaciones.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-0.5 text-primary">•</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <Label>Observaciones (opcional)</Label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Agregar nota sobre la diferencia..."
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setPaso('conteo')} disabled={procesando}>
            Volver
          </Button>
          <Button className="flex-1" onClick={handleConfirmar} disabled={procesando}>
            {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            {procesando ? 'Cerrando…' : 'Cerrar Turno'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-muted/30 p-3 text-sm">
        <div className="mb-2 font-bold text-muted-foreground">Resumen del turno</div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span>Fondo inicial</span>
            <span className="font-semibold">{fmt(turno.montoInicial)}</span>
          </div>
          <div className="flex justify-between">
            <span>+ Ventas en efectivo</span>
            <span className="font-semibold text-emerald-600">{fmt(turno.totalEfectivo)}</span>
          </div>
          {(turno.totalGastosEfectivo ?? 0) > 0 && (
            <div className="flex justify-between">
              <span>- Gastos en efectivo</span>
              <span className="font-semibold text-red-600">-{fmt(turno.totalGastosEfectivo)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 font-bold">
            <span>Debería haber</span>
            <span>{fmt(turno.montoInicial + turno.totalEfectivo - (turno.totalGastosEfectivo || 0))}</span>
          </div>
        </div>
      </div>

      <div>
        <Label>¿Cuánto contaste en caja? (S/)</Label>
        <Input
          type="number"
          inputMode="decimal"
          value={montoFinal}
          onChange={(e) => setMontoFinal(e.target.value)}
          placeholder="0.00"
          className="mt-1"
        />
      </div>

      {monto > 0 && (
        <div className={cn(
          'rounded-lg p-2.5 text-center text-sm font-bold',
          monto === (turno.montoInicial + turno.totalEfectivo - (turno.totalGastosEfectivo || 0))
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
            : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
        )}>
          {(() => {
            const esperado = turno.montoInicial + turno.totalEfectivo - (turno.totalGastosEfectivo || 0)
            const diff = monto - esperado
            return diff === 0 ? '✅ Caja cuadrada' : `Diferencia: ${fmt(diff)}`
          })()}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={procesando}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={handleAnalizar} disabled={monto <= 0 || procesando}>
          <Search className="h-4 w-4" />
          Auditar y Cerrar
        </Button>
      </div>
    </div>
  )
}
