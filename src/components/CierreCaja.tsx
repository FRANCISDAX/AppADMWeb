import { AlertTriangle, CheckCircle, Info, Loader2, Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { analizarCierre, type ResultadoAuditoria } from '@/lib/auditoria-caja'
import { efectivoEsperadoDe, mediosDelTurno, type ConciliacionMedios } from '@/lib/arqueo'
import { etiquetaYape, totalYape, type PagoYape } from '@/lib/yape'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

type Props = {
  turno: {
    montoInicial: number
    totalEfectivo: number
    totalGastosEfectivo: number
    /** Vuelto pagado por transferencia (sale del cajón). Fórmula única: `efectivoEsperadoDe`. */
    vueltoTransferencia?: number
    ventasDelTurno: any[]
  }
  /** Conteo ciego: no muestra el "Debería haber" hasta que el cajero registre el conteo. */
  conteoCiego?: boolean
  /**
   * Avisos de Yape **confirmados en este turno** (`tblPagosYape` con `estado: 'usado'`): es lo que
   * el sistema puede afirmar que entró por Yape con un aviso detrás. Lo trae quien monta el cierre
   * (`Turnos.tsx`), porque este componente no lee Firestore.
   *
   * ⚠️ `null` = **todavía no llegaron** (la consulta está en vuelo), `[]` = llegaron y no hay
   * ninguno. La diferencia importa: con `[]` por defecto, al abrir el cierre el bloque mostraba un
   * segundo el aviso rojo de «no llegó ningún aviso» **antes** de que la consulta terminara.
   */
  pagosYape?: PagoYape[] | null
  onConfirm: (montoFinal: number, observaciones: string, conciliacion: ConciliacionMedios) => Promise<void>
  onCancel: () => void
  procesando: boolean
}

/** Lo que el cajero declara que le llegó por cada billetera, y la diferencia contra el sistema. */
export type { ConciliacionMedios }

export function CierreCaja({ turno, conteoCiego = false, pagosYape, onConfirm, onCancel, procesando }: Props) {
  const [montoFinal, setMontoFinal] = React.useState('')
  const [observaciones, setObservaciones] = React.useState('')
  const [paso, setPaso] = React.useState<'conteo' | 'analisis'>('conteo')
  const [resultado, setResultado] = React.useState<ResultadoAuditoria | null>(null)
  const [declarados, setDeclarados] = React.useState<Record<string, string>>({})

  const monto = parseFloat(montoFinal) || 0
  // Misma fórmula que usa el cierre y el arqueo: antes acá faltaba el vuelto por
  // transferencia, así que el cajero podía ver un "Debería haber" distinto al que
  // el sistema guardaba.
  const esperado = efectivoEsperadoDe(turno)
  // Medios electrónicos del turno (lo que dice el sistema) para conciliar billetera por
  // billetera. Si el cajero no declara nada, queda sin dato: la conciliación es opcional.
  const medios = React.useMemo(
    () => mediosDelTurno({ ventasDelTurno: turno.ventasDelTurno }),
    [turno.ventasDelTurno],
  )

  /**
   * 🔑 **Cruce de Yape**: lo que el sistema dice que entró por Yape (ventas, cobros y notas del
   * turno) contra los **avisos confirmados** (`tblPagosYape` usados en este turno).
   *
   * Para qué: un aviso es la prueba de que al negocio le llegó la plata. Si hubo cobros por Yape
   * y **ningún aviso**, o el puente no está andando o el cajero los cargó a mano — y eso hay que
   * verlo al cerrar, no en una revisión de la semana siguiente. **No bloquea el cierre**: informa.
   */
  const yapeSistema = medios.find((m) => m.medio === 'yape')?.monto ?? 0
  const avisosYape = pagosYape ?? []
  const cargandoYape = pagosYape == null
  const avisosYapeTotal = totalYape(avisosYape)
  const cruceYape = Math.round((yapeSistema - avisosYapeTotal) * 100) / 100

  function armarConciliacion(): ConciliacionMedios {    const res: ConciliacionMedios = {}
    for (const m of medios) {
      const declarado = parseFloat(String(declarados[m.medio] ?? '').replace(',', '.')) || 0
      res[m.medio] = { sistema: m.monto, declarado, diferencia: Math.round((declarado - m.monto) * 100) / 100 }
    }
    return res
  }

  function handleAnalizar() {
    if (monto <= 0) return
    const r = analizarCierre({
      montoInicial: turno.montoInicial,
      totalEfectivo: turno.totalEfectivo,
      totalGastosEfectivo: turno.totalGastosEfectivo || 0,
      vueltoTransferencia: turno.vueltoTransferencia || 0,
      ventasDelTurno: turno.ventasDelTurno || [],
      efectivoReal: monto,
    })
    setResultado(r)
    setPaso('analisis')
  }

  async function handleConfirmar() {
    await onConfirm(monto, observaciones, armarConciliacion())
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
      {conteoCiego ? (
        <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          <b>Conteo ciego activado.</b> Contá el cajón y escribí el total: el sistema recién
          después te muestra cuánto debería haber y la diferencia.
        </div>
      ) : (
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
              <span>{fmt(esperado)}</span>
            </div>
          </div>
        </div>
      )}

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

      {/* Conciliación por billetera: opcional, se guarda con el cierre. El dato fino
          (Yape/Plin/tarjeta) existe desde el 16/09; antes queda "Transferencia (sin detalle)". */}
      {medios.length > 0 && (
        <div className="rounded-xl border p-3">
          <div className="text-sm font-bold">Cobros por billetera (opcional)</div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Escribí lo que <b>realmente te llegó</b> a cada una. Si no lo revisaste, dejalas vacías.
          </p>
          <div className="space-y-2">
            {medios.map((m) => {
              const declarado = parseFloat(String(declarados[m.medio] ?? '').replace(',', '.')) || 0
              const diferencia = Math.round((declarado - m.monto) * 100) / 100
              return (
                <div key={m.medio} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {m.icono} {m.label}
                    <span className="ml-1 text-muted-foreground">(sistema {fmt(m.monto)})</span>
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={declarados[m.medio] ?? ''}
                    onChange={(e) => setDeclarados((d) => ({ ...d, [m.medio]: e.target.value }))}
                    placeholder="—"
                    className="h-8 w-24 text-right"
                  />
                  <span
                    className={cn(
                      'num w-20 text-right text-[11px] font-bold',
                      declarado === 0 ? 'text-muted-foreground' : diferencia === 0 ? 'text-emerald-600' : 'text-destructive',
                    )}
                  >
                    {declarado === 0 ? '—' : diferencia === 0 ? 'OK' : fmt(diferencia)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 🔑 Cruce de Yape: los avisos que el sistema confirmó, contra los cobros por Yape del turno.
          No bloquea el cierre: si algo no cuadra, se explica acá y se decide con el cajero. */}
      {(avisosYape.length > 0 || yapeSistema > 0) && (
        <div className="rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">📱 Cruce de Yape</div>
            <span className="num text-xs font-bold">
              {cargandoYape ? 'leyendo…' : `${avisosYape.length} aviso(s) · ${fmt(avisosYapeTotal)}`}
            </span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Avisos que llegaron al PDV y se aplicaron a una venta (lo que el sistema puede afirmar
            que entró por Yape), contra lo que dice el turno.
          </p>

          {avisosYape.length > 0 && (
            <ul className="space-y-1">
              {avisosYape.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate">{etiquetaYape(p)}</span>
                  <span className="shrink-0 text-muted-foreground">{p.documento || '—'}</span>
                </li>
              ))}
            </ul>
          )}

          {!cargandoYape && avisosYape.length === 0 && yapeSistema > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              ⚠️ El turno tiene <b>{fmt(yapeSistema)}</b> cobrados por Yape pero <b>no llegó ningún aviso</b> al
              PDV: revisá que el puente de Yape esté andando (y que los avisos no hayan quedado vencidos sin
              usarse). Si los cobros por Yape se cargaron a mano, es normal y esta línea no marca ningún error.
            </p>
          )}

          {avisosYape.length > 0 && cruceYape !== 0 && (            <p className="mt-2 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
              Diferencia: <b className="num">{fmt(cruceYape)}</b>. Son cobros por Yape cargados a mano (sin aviso)
              o avisos que no se llegaron a usar. Revisalos antes de cerrar: si son ventas por Yape que no tienen
              aviso detrás, no hay prueba de que la plata haya llegado.
            </p>
          )}
        </div>
      )}

      {!conteoCiego && monto > 0 && (
        <div className={cn(
          'rounded-lg p-2.5 text-center text-sm font-bold',
          monto === esperado
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
            : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
        )}>
          {(() => {
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
