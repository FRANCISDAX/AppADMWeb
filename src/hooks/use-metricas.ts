import * as React from 'react'
import { bitacora } from '@/lib/bitacora'
import { registrarMetricas, type MedidasWeb } from '@/services/metricas'
import { METRICAS_WEB } from '@/lib/observabilidad'

/**
 * 🔑 **Captura de Web Vitals del equipo donde corre el app** (LCP, INP, CLS, FCP, TTFB).
 *
 * 📌 **Por qué existe** (03/11/2026): el rendimiento del PDV estaba medido **a mano, una vez y en el
 * entorno del que programa** (211 → 23-46 ms con 2.000 SKU). Lo que importa es la caja del local: una PC de
 * 2015 puede ir 5 veces más lenta, y hoy eso solo se sabe por el comentario del cajero. Con esto cada visita
 * aporta su medición al documento del día (`tblMetricas`) y el panel muestra la tendencia.
 *
 * **Cómo se hace, sin dependencias** (`web-vitals` sería un paquete más para 60 líneas):
 * - `PerformanceObserver` para LCP, CLS, FCP y TTFB; INP se **aproxima** con la interacción más lenta
 *   (el INP real usa un percentil de todas las interacciones; se documenta así en el panel).
 * - Se manda **una vez por sesión**, al ocultarse la pestaña o al cerrarse: mandar en cada métrica
 *   multiplicaría escrituras sin agregar información.
 * - ⚠️ Si el navegador no soporta `PerformanceObserver` (o el equipo es viejo), **no se mide y listo**:
 *   no hay error, simplemente no suma muestras.
 */
export function useMetricas(): void {
  const enviado = React.useRef(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return

    const medidas: MedidasWeb = {}
    const observadores: PerformanceObserver[] = []

    const observar = (tipo: string, manejar: (entradas: PerformanceEntryList) => void) => {
      try {
        const obs = new PerformanceObserver((lista) => manejar(lista.getEntries()))
        obs.observe({ type: tipo, buffered: true })
        observadores.push(obs)
      } catch {
        // El navegador no soporta ese tipo de entrada: se ignora (no es un error de la app).
      }
    }

    // LCP: el último candidato es el definitivo.
    observar('largest-contentful-paint', (entradas) => {
      const ultima = entradas[entradas.length - 1]
      if (ultima) medidas.lcp = ultima.startTime
    })

    // CLS: suma de los desplazamientos que no vienen de una interacción del usuario.
    let cls = 0
    observar('layout-shift', (entradas) => {
      for (const e of entradas as (PerformanceEntry & { value?: number; hadRecentInput?: boolean })[]) {
        if (!e.hadRecentInput && typeof e.value === 'number') cls += e.value
      }
      medidas.cls = cls
    })

    // FCP y TTFB salen de una sola lectura de `paint` + `navigation`.
    observar('paint', (entradas) => {
      const fcp = entradas.find((e) => e.name === 'first-contentful-paint')
      if (fcp) medidas.fcp = fcp.startTime
    })
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (nav && nav.responseStart > 0) medidas.ttfb = nav.responseStart
    } catch {
      // Sin Navigation Timing no hay TTFB.
    }

    // INP aproximado: la interacción más lenta (duración del evento con `interactionId`).
    observar('event', (entradas) => {
      for (const e of entradas as (PerformanceEntry & { interactionId?: number })[]) {
        if (!e.interactionId) continue
        if (medidas.inp === undefined || e.duration > medidas.inp) medidas.inp = e.duration
      }
    })

    const mandar = () => {
      if (enviado.current) return
      enviado.current = true
      // Solo se envían las métricas que existen: `registrarMetricas` descarta el resto.
      const presentes = METRICAS_WEB.filter((m) => medidas[m] !== undefined)
      if (presentes.length === 0) return
      // `beforeunload`/`pagehide` no esperan promesas: se dispara y se olvida (el servicio nunca lanza).
      void registrarMetricas(medidas)
    }

    // Al ocultarse la pestaña se manda (es el momento más confiable: `beforeunload` no siempre corre).
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') mandar()
    }
    document.addEventListener('visibilitychange', alOcultar)
    window.addEventListener('pagehide', mandar)

    return () => {
      document.removeEventListener('visibilitychange', alOcultar)
      window.removeEventListener('pagehide', mandar)
      for (const o of observadores) {
        try {
          o.disconnect()
        } catch {
          // Si ya estaba desconectado, no hay nada que hacer.
        }
      }
    }
  }, [])
}

/**
 * Anota un evento en la bitácora de la sesión (los «breadcrumbs» que viajan con cada error).
 * ⚠️ **Nunca datos del negocio**: tipos de evento y, a lo sumo, un detalle corto (ver `lib/bitacora.ts`).
 */
export function registrarEvento(tipo: string, detalle?: string): void {
  bitacora.registrar(tipo, detalle)
}
