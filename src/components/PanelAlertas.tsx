/**
 * **Panel de alertas proactivas** (tablero): lo que ya está mal, sin tener que ir a buscarlo.
 *
 * 🔑 **Por qué está en el tablero y no en el PDV**: el PDV ya avisa de lo suyo en vivo (el latido del
 * puente y los avisos de Yape están ahí y se ven mientras se cobra). Lo que no existía era un lugar
 * donde el dueño vea **el conjunto** al abrir la app: el puente caído, un turno de otro día sin
 * cerrar, stock agotado, avisos sin usar, diferencias de caja y anulaciones.
 *
 * ⚠️ **Una alerta es un aviso, no un candado**: este panel **no bloquea nada** (ni cobrar, ni cerrar
 * el turno, ni vender). Es el mismo criterio que el cruce del cierre de Yape: informa.
 *
 * ⚠️ **Qué ve cada rol**: el catálogo de roles da `dashboard` al cajero y al vendedor, así que el
 * panel **no puede mostrar todo a todos**:
 *
 * - las alertas que **el cajero tiene que atender** (puente, caja abierta, stock, avisos de Yape)
 *   las ve cualquiera que pueda abrir el tablero;
 * - las que **nombran personas** (anulaciones y descuentos por cajero) y las que son de **control**
 *   (diferencias de caja) piden el permiso de la sección a la que llevan y, las dos primeras,
 *   además `verTodo` — que es exactamente lo que ya hace el reporte: sin `verTodo`, cada uno ve
 *   **sus** documentos y no los del compañero (ver `lib/alcance-reportes.ts`).
 */
import * as React from 'react'
import {
  AlertTriangle,
  BellRing,
  ChevronRight,
  Info,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePermisos } from '@/context/permisos'
import { useAlertas, POSPONER_HORAS } from '@/hooks/use-alertas'
import type { Alerta, SeveridadAlerta } from '@/lib/alertas'
import { cn } from '@/lib/utils'
import { haceCuantoYape } from '@/lib/yape'

/** La sección del menú con la que se abre el detalle de cada alerta (las claves de `App.tsx`). */
const PERM_DE_SECCION: Record<string, string> = {
  pdv: 'ventas',
  turnos: 'turnos',
  inventario: 'inventario',
  reportes: 'reportes',
  auditoria: 'auditoria',
  auditoriaCaja: 'auditoria',
}

/** Las reglas que nombran a una persona: piden `verTodo` (si no, cada uno vería lo del compañero). */
const REGLAS_CON_NOMBRES: Alerta['regla'][] = ['anulaciones', 'descuentos']

const ESTILO: Record<SeveridadAlerta, { caja: string; chip: string; titulo: string; icono: typeof Info }> = {
  critico: {
    caja: 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
    chip: 'bg-red-600 text-white',
    titulo: 'text-red-700 dark:text-red-300',
    icono: ShieldAlert,
  },
  aviso: {
    caja: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
    chip: 'bg-amber-600 text-white',
    titulo: 'text-amber-700 dark:text-amber-300',
    icono: AlertTriangle,
  },
  info: {
    caja: 'border-border bg-muted/40',
    chip: 'bg-slate-500 text-white',
    titulo: 'text-muted-foreground',
    icono: Info,
  },
}

const ETIQUETA: Record<SeveridadAlerta, string> = { critico: 'URGENTE', aviso: 'REVISAR', info: 'INFO' }

export function PanelAlertas({ onIr }: { onIr?: (seccion: string) => void } = {}) {
  const { tienePermiso } = usePermisos()
  const { visibles, pendientes, resumen, pospuestas, cargando, error, revisadoEn, recargar, posponer, mostrarDeNuevo } =
    useAlertas()

  const puedeVer = React.useCallback(
    (a: Alerta): boolean => {
      // Una alerta que nombra personas solo la ve quien ve todas las ventas (dueño/supervisor).
      if (REGLAS_CON_NOMBRES.includes(a.regla) && !tienePermiso('verTodo')) return false
      const perm = a.seccion ? PERM_DE_SECCION[a.seccion] : undefined
      return !perm || tienePermiso(perm)
    },
    [tienePermiso],
  )

  const paraMirar = visibles.filter((a) => a.severidad !== 'info' && puedeVer(a))
  const alDia = visibles.filter((a) => a.severidad === 'info' && puedeVer(a))
  const ocultas = pospuestas.filter(puedeVer)

  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing className={cn('h-5 w-5', paraMirar.some((a) => a.severidad === 'critico') ? 'text-red-600' : 'text-primary')} />
          <h3 className="font-bold">Alertas</h3>
          {paraMirar.length > 0 && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-bold text-white',
                paraMirar.some((a) => a.severidad === 'critico') ? 'bg-red-600' : 'bg-amber-600',
              )}
            >
              {paraMirar.length}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {resumen}
            {revisadoEn > 0 && <> · revisado {haceCuantoYape(revisadoEn)}</>}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void recargar()} disabled={cargando}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', cargando && 'animate-spin')} />
          Revisar ahora
        </Button>
      </div>

      {error && (
        // ⚠️ Un fallo de lectura no puede parecer «todo en orden»: se dice, con el motivo.
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      {!error && revisadoEn === 0 && cargando && (
        <p className="mt-3 text-xs text-muted-foreground">Revisando…</p>
      )}

      {revisadoEn > 0 && paraMirar.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nada para mirar: el puente late, no hay turnos viejos abiertos, no hay avisos de Yape sin usar y el
          stock está por encima del mínimo.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {paraMirar.map((a) => {
          const e = ESTILO[a.severidad]
          const Icono = e.icono
          const perm = a.seccion ? PERM_DE_SECCION[a.seccion] : undefined
          return (
            <div key={a.id} className={cn('rounded-lg border p-3', e.caja)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Icono className={cn('mt-0.5 h-4 w-4 shrink-0', e.titulo)} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', e.chip)}>{ETIQUETA[a.severidad]}</span>
                      <span className={cn('text-sm font-bold', e.titulo)}>{a.titulo}</span>
                    </div>
                    <p className="mt-1 text-xs text-foreground/80">{a.detalle}</p>
                    <p className="mt-1 text-[11px] italic text-muted-foreground">{a.accion}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.seccion && onIr && (!perm || tienePermiso(perm)) && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onIr(a.seccion as string)}>
                      Ver <ChevronRight className="ml-0.5 h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    title={`Ocultar esta alerta por ${POSPONER_HORAS} h (podés volver a mostrarla)`}
                    onClick={() => void posponer(a.id)}
                  >
                    <EyeOff className="mr-0.5 h-3 w-3" /> Posponer
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {alDia.length > 0 && (
        <div className="mt-3 border-t pt-2">
          {alDia.map((a) => (
            <p key={a.id} className="text-[11px] text-muted-foreground">
              <span className="font-medium">{a.titulo}:</span> {a.detalle} <span className="italic">{a.accion}</span>
            </p>
          ))}
        </div>
      )}

      {ocultas.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-[11px] text-muted-foreground">
            Pospuesta(s): {ocultas.map((a) => a.titulo).join(' · ')}
          </span>
          {ocultas.map((a) => (
            <button
              key={a.id}
              onClick={() => void mostrarDeNuevo(a.id)}
              className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <RotateCcw className="h-3 w-3" /> Mostrar «{a.titulo}» de nuevo
            </button>
          ))}
        </div>
      )}

      {pendientes > 0 && paraMirar.length === 0 && (
        // El filtro por permisos puede esconder **todo**: se dice, en vez de dejar el panel como si
        // no hubiera nada (un dueño que no ve sus propias alertas no tiene forma de sospecharlo).
        <p className="mt-2 text-[11px] text-muted-foreground">
          Hay {pendientes} alerta(s) que tu usuario no puede ver (piden acceso a Reportes o Auditoría).
        </p>
      )}
    </div>
  )
}
