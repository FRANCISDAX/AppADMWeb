import { Activity, AlertTriangle, Gauge, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { obtenerErrores, type ErrorApp } from '@/services/errores'
import { obtenerMetricas } from '@/services/metricas'
import {
  NOMBRE_METRICA,
  formatoMetrica,
  resumenDeErrores,
  resumirMetricas,
  type DiaDeMetricas,
  type NivelMetrica,
} from '@/lib/observabilidad'

/**
 * 🔑 **Observabilidad sin terceros** (Auditoría → Observabilidad, 03/11/2026).
 *
 * Responde tres preguntas que antes había que ir a buscar a mano:
 * 1. **¿Qué está fallando?** Errores **agrupados**: tres cobros fallidos son **un** problema, no tres, y se
 *    ve quiénes lo vieron y en qué equipos (¿una caja o todo el local?).
 * 2. **¿Cómo se siente el app en las cajas?** Web Vitals medidos en el equipo real (`tblMetricas`), con los
 *    umbrales oficiales, el promedio y el peor del período.
 * 3. **¿Está empeorando?** La serie por día, que es lo que el promedio de un día no dice.
 *
 * ⚠️ **No bloquea nada y no reemplaza al panel de Errores**: ese sigue mostrando el detalle de cada registro
 * (stack, ruta, equipo) para depurar. Este muestra el **panorama**.
 */

const COLOR_NIVEL: Record<NivelMetrica, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  atencion: 'text-amber-600 dark:text-amber-400',
  malo: 'text-destructive',
}

const FONDO_NIVEL: Record<NivelMetrica, string> = {
  ok: 'bg-emerald-500',
  atencion: 'bg-amber-500',
  malo: 'bg-destructive',
}

/** «hace 2 h», «hace 3 d»: para leer la última vez sin hacer cuentas. */
function haceCuanto(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

export function ObservabilidadPanel() {
  const [errores, setErrores] = React.useState<ErrorApp[]>([])
  const [dias, setDias] = React.useState<DiaDeMetricas[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [fallo, setFallo] = React.useState<string | null>(null)

  // La lectura, sin tocar estado: la usan el montaje y el botón «Actualizar».
  const traer = React.useCallback(async () => {
    const [listaErrores, listaDias] = await Promise.all([obtenerErrores(), obtenerMetricas(14)])
    return { listaErrores, listaDias }
  }, [])

  const cargar = React.useCallback(async () => {
    setCargando(true)
    setFallo(null)
    try {
      const { listaErrores, listaDias } = await traer()
      setErrores(listaErrores)
      setDias(listaDias)
    } catch (e) {
      // Si falla la lectura, la pantalla lo dice (no se muestra «todo vacío» como si estuviera sano).
      setFallo((e as Error).message || 'No se pudieron leer las métricas')
    } finally {
      setCargando(false)
    }
  }, [traer])

  // ⚠️ El montaje NO llama a `cargar()`: cambiaría estado **dentro** del efecto (warning de `set-state-in-
  // effect`, que es baseline que no se sube). Se hace la lectura en la promesa y se cambia el estado ahí.
  React.useEffect(() => {
    let vigente = true
    traer()
      .then(({ listaErrores, listaDias }) => {
        if (!vigente) return
        setErrores(listaErrores)
        setDias(listaDias)
      })
      .catch((e: unknown) => {
        if (vigente) setFallo((e as Error)?.message || 'No se pudieron leer las métricas')
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [traer])

  const erroresResumen = React.useMemo(() => resumenDeErrores(errores), [errores])
  const metricas = React.useMemo(() => resumirMetricas(dias), [dias])
  // El máximo de la serie sirve para escalar las barras del gráfico.
  const maxErrores = Math.max(1, ...metricas.serie.map((s) => s.errores))

  if (cargando) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Midiendo…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Últimos <strong>{errores.length}</strong> errores registrados y <strong>{metricas.dias}</strong> días de
          métricas de <strong>este</strong> negocio. Los errores repetidos se cuentan una sola vez por minuto.
        </p>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {fallo && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No se pudo leer: {fallo}</span>
        </div>
      )}

      {/* ── Rendimiento ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card p-4 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Gauge className="h-4 w-4 text-primary" /> Rendimiento en las cajas
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Medido en el equipo donde se cobra, no en el de desarrollo. Umbrales oficiales de Web Vitals
          {metricas.muestras > 0 ? ` · ${metricas.muestras} visita${metricas.muestras === 1 ? '' : 's'} medida${metricas.muestras === 1 ? '' : 's'}` : ''}.
        </p>

        {metricas.muestras === 0 ? (
          <p className="mt-3 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Todavía no hay muestras. Se miden solas al usar el app; aparecen acá después de la primera visita
            de cada equipo.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {metricas.porMetrica.map((m) => (
              <div key={m.metrica} className="rounded-xl border bg-background/60 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {NOMBRE_METRICA[m.metrica].split(' · ')[0]}
                  </span>
                  <span className={cn('num text-lg font-extrabold', m.nivel ? COLOR_NIVEL[m.nivel] : 'text-muted-foreground')}>
                    {formatoMetrica(m.metrica, m.promedio)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {NOMBRE_METRICA[m.metrica].split(' · ')[1] ?? ''}
                  {m.peor !== null ? ` · peor ${formatoMetrica(m.metrica, m.peor)}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tendencia por día ───────────────────────────────────────────── */}
      {metricas.serie.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Activity className="h-4 w-4 text-primary" /> Errores por día
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            La serie que el promedio no muestra: lo que importa es si **empeora**, no el total.
          </p>
          <div className="mt-3 flex items-end gap-1.5">
            {metricas.serie.map((p) => (
              <div key={p.dia} className="flex flex-1 flex-col items-center gap-1" title={`${p.dia} · ${p.errores} error(es) · ${p.muestras} visita(s)`}>
                <span className="num text-[10px] text-muted-foreground">{p.errores}</span>
                <div
                  className={cn('w-full rounded-t', p.errores > 0 ? 'bg-destructive/70' : 'bg-muted')}
                  style={{ height: `${Math.max(3, (p.errores / maxErrores) * 48)}px` }}
                />
                <span className="text-[10px] text-muted-foreground">{p.dia.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Errores agrupados ───────────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card p-4 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 text-primary" /> Qué está fallando
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Agrupado por <strong>problema</strong>, no por registro: los números de comprobante y los ids cambian
          en cada ocurrencia y no son una falla nueva.
        </p>

        {erroresResumen.problemas === 0 ? (
          <p className="mt-3 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Ningún error registrado 🎉
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5"><strong className="num">{erroresResumen.total}</strong> registros</span>
              <span className="rounded-full bg-muted px-2 py-0.5"><strong className="num">{erroresResumen.problemas}</strong> problemas</span>
              <span className="rounded-full bg-muted px-2 py-0.5"><strong className="num">{erroresResumen.usuarios}</strong> usuarios</span>
              <span className="rounded-full bg-muted px-2 py-0.5"><strong className="num">{erroresResumen.equipos}</strong> equipos</span>
            </div>
            <div className="mt-3 divide-y overflow-hidden rounded-xl border">
              {erroresResumen.grupos.map((g) => (
                <div key={g.huella} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">
                    {g.contexto}
                  </span>
                  <span className="min-w-[12rem] flex-1 truncate text-sm font-medium" title={g.mensaje}>{g.mensaje}</span>
                  <span className="num shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-extrabold text-destructive">
                    ×{g.cantidad}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{haceCuanto(g.ultimaVez)}</span>
                  {g.usuarios.length > 0 && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{g.usuarios.slice(0, 3).join(', ')}{g.usuarios.length > 3 ? '…' : ''}</span>
                  )}
                  {g.equipos.length > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={g.equipos.join(' · ')}>
                      <Smartphone className="h-3 w-3" /> {g.equipos[0]}{g.equipos.length > 1 ? ` +${g.equipos.length - 1}` : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full">
              {erroresResumen.grupos.slice(0, 6).map((g) => (
                <span
                  key={g.huella}
                  className={FONDO_NIVEL[g.cantidad >= 3 ? 'malo' : g.cantidad === 2 ? 'atencion' : 'ok']}
                  style={{ width: `${(g.cantidad / erroresResumen.total) * 100}%` }}
                  title={`${g.cantidad} × ${g.mensaje}`}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        El detalle de cada error (stack, ruta, equipo) sigue en la pestaña <strong>Errores</strong>.
        Sin servicios externos: todo esto vive en la base del negocio.
      </p>
    </div>
  )
}
