/**
 * Las **alertas proactivas** de la pantalla: carga, evalúa, ordena y deja posponer.
 *
 * 🔑 **Qué hace y qué NO hace**: acá no hay ninguna regla (viven en `lib/alertas.ts`, puras y
 * testeadas) ni ninguna consulta a Firestore (viven en `services/alertas.ts`). El hook solo une las
 * tres piezas y expone el resultado a la pantalla.
 *
 * ⚠️ **El «ahora» se congela al revisar** (`revisadoEn`): si cada render tomara `Date.now()`, el
 * «hace 20 min» y los vencimientos de Yape cambiarían en cada tecla que escriba el usuario y las
 * alertas bailarían en pantalla. Se actualiza al revisar (a mano o cada 5 minutos, que es el mismo
 * ciclo del latido del puente).
 *
 * ⚠️ **El catálogo sale de `useProductos()`** (el `onSnapshot` que ya usa el PDV): la regla de stock
 * no cuesta ninguna lectura extra.
 */
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'
import {
  alertasVisibles,
  contarPendientes,
  evaluarAlertas,
  resumenAlertas,
  type Alerta,
} from '@/lib/alertas'
import {
  cargarContextoAlertas,
  cargarVistasAlertas,
  posponerAlerta,
  type ContextoAlertasFirestore,
} from '@/services/alertas'

/** Cada cuánto se vuelve a revisar solo (el puente late cada 5 min: no tiene sentido mirar más seguido). */
export const REFRESCO_ALERTAS_MINUTOS = 5

/** Cuánto se pospone una alerta con un toque (el usuario puede volver a mostrarla antes). */
export const POSPONER_HORAS = 4

export type UseAlertas = {
  /** Todas las alertas (incluidas las pospuestas y las informativas), ya ordenadas. */
  alertas: Alerta[]
  /** Las que corresponde mostrar ahora (sin las pospuestas). */
  visibles: Alerta[]
  /** Cuántas cosas hay para mirar (no cuenta lo informativo). */
  pendientes: number
  resumen: string
  /** Las que el usuario pospuso y siguen ocultas (para poder volver a mostrarlas). */
  pospuestas: Alerta[]
  cargando: boolean
  error: string | null
  /** Cuándo se revisó por última vez (ms). `0` mientras no se revisó nunca. */
  revisadoEn: number
  recargar: () => Promise<void>
  posponer: (alertaId: string) => Promise<void>
  mostrarDeNuevo: (alertaId: string) => Promise<void>
}

export function useAlertas(): UseAlertas {
  const { user } = useAuth()
  const { config } = useConfiguracion()
  const { productos } = useProductos()
  const [datos, setDatos] = React.useState<ContextoAlertasFirestore | null>(null)
  const [pospuestasMs, setPospuestasMs] = React.useState<Record<string, number>>({})
  const [revisadoEn, setRevisadoEn] = React.useState(0)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const usuarioId = user?.uid ?? ''

  const recargar = React.useCallback(async () => {
    setCargando(true)
    try {
      const [contexto, vistas] = await Promise.all([
        cargarContextoAlertas(),
        cargarVistasAlertas(usuarioId),
      ])
      setDatos(contexto)
      setPospuestasMs(vistas.pospuestas)
      setRevisadoEn(Date.now())
      setError(null)
    } catch (e) {
      // 🔑 Un fallo de lectura NO puede parecer «todo en orden»: se dice en pantalla y se dejan las
      // alertas de la revisión anterior (si las hay) a la vista.
      setError(`No se pudieron revisar las alertas: ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }, [usuarioId])

  React.useEffect(() => {
    // ⚠️ La primera revisión va **diferida un tick**: `recargar()` marca `cargando` en el acto y
    // llamarlo derecho dentro del efecto es un `setState` sincrónico en un efecto (render en
    // cascada). Además así el primer pintado muestra «Revisando…» en vez de un panel vacío.
    const id = window.setTimeout(() => void recargar(), 0)
    return () => window.clearTimeout(id)
  }, [recargar])

  // Revisión periódica mientras la pantalla está abierta (se cancela al salir de ella).
  React.useEffect(() => {
    const id = window.setInterval(() => void recargar(), REFRESCO_ALERTAS_MINUTOS * 60000)
    return () => window.clearInterval(id)
  }, [recargar])

  // ⚠️ El «ahora» es **la hora de la última revisión**, no `Date.now()`: leer el reloj durante el
  // render es impuro (el valor cambiaría en cada tecla y las alertas bailarían en pantalla). Mientras
  // `revisadoEn` es 0 todavía no se revisó, y en ese momento no hay ninguna alerta que evaluar.
  const ahora = revisadoEn

  const alertas = React.useMemo(() => {
    if (!datos) return []
    return evaluarAlertas({
      ahora,
      config,
      productos,
      latido: datos.latido,
      turnosAbiertos: datos.turnosAbiertos,
      turnosCerradosHoy: datos.turnosCerradosHoy,
      documentosHoy: datos.documentosHoy,
      avisosYape: datos.avisosYape,
      documentosSunat: datos.documentosSunat,
    })
  }, [datos, config, productos, ahora])

  const visibles = React.useMemo(
    () => alertasVisibles(alertas, { pospuestas: pospuestasMs, ahora }),
    [alertas, pospuestasMs, ahora],
  )

  const ocultas = React.useMemo(
    () =>
      alertas.filter((a) => {
        if (a.severidad === 'info') return false
        return (Number(pospuestasMs[a.id]) || 0) > ahora
      }),
    [alertas, pospuestasMs, ahora],
  )

  const guardarPospuesta = React.useCallback(
    async (alertaId: string, hasta: number) => {
      if (!usuarioId) return
      const previo = pospuestasMs
      // Optimista: la alerta desaparece al toque y, si el guardado falla, vuelve y se avisa.
      setPospuestasMs((p) => ({ ...p, [alertaId]: hasta }))
      const r = await posponerAlerta(usuarioId, alertaId, hasta)
      if (!r.success) {
        setPospuestasMs(previo)
        setError(`No se pudo guardar el cambio: ${r.error ?? 'error desconocido'}`)
      }
    },
    [usuarioId, pospuestasMs],
  )

  const posponer = React.useCallback(
    (alertaId: string) => guardarPospuesta(alertaId, Date.now() + POSPONER_HORAS * 3600000),
    [guardarPospuesta],
  )

  // Volver a mostrarla es guardar una hora pasada: no se borra el campo (deja rastro de que se pospuso).
  const mostrarDeNuevo = React.useCallback(
    (alertaId: string) => guardarPospuesta(alertaId, 0),
    [guardarPospuesta],
  )

  return {
    alertas,
    visibles,
    pendientes: contarPendientes(visibles),
    resumen: resumenAlertas(visibles),
    pospuestas: ocultas,
    cargando,
    error,
    revisadoEn,
    recargar,
    posponer,
    mostrarDeNuevo,
  }
}
