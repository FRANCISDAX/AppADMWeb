/**
 * 🔑 **Bitácora de la sesión** («breadcrumbs»): los últimos eventos de este equipo, en memoria, para saber
 * **qué estaba haciendo el cajero** cuando reventó algo.
 *
 * 📌 **Por qué existe** (03/11/2026): un error guardado solo con su `stack` dice *dónde* se rompió, no *qué
 * venía haciendo* la persona. Es justo lo que un Sentry aporta y lo que no se puede reconstruir después:
 * si la caja 2 falló al cobrar, «entró a PDV → buscó «gaseosa» → agregó 3 items → aplicó descuento → cobró»
 * explica el error; el stack solo, no.
 *
 * ⚠️ **Se guarda SOLO en memoria y solo el tipo de evento** (nunca precios, nombres de clientes ni DNI): el
 * detalle que se adjunta al error tiene que poder mandarse a cualquier lado sin filtrar datos del negocio.
 * Se pierde al recargar la página, que es lo correcto: la bitácora es de *esta* sesión.
 */
import type { LineaBitacora } from './observabilidad.ts'

/** Cuántos eventos se conservan. Más que esto no ayuda a explicar una falla y agranda el documento. */
export const MAXIMO_EVENTOS = 25

export type Bitacora = {
  /** Anota un evento. `detalle` tiene que ser corto y sin datos sensibles. */
  registrar: (tipo: string, detalle?: string) => void
  /** Los eventos guardados, del más viejo al más nuevo. */
  eventos: () => LineaBitacora[]
  limpiar: () => void
}

export function crearBitacora(maximo = MAXIMO_EVENTOS): Bitacora {
  let lista: LineaBitacora[] = []
  return {
    registrar(tipo, detalle) {
      const t = String(tipo ?? '').trim()
      if (!t) return
      // Ojo: NO se guardan números de documento, montos ni datos de clientes.
      const linea: LineaBitacora = { t: Date.now(), tipo: t.slice(0, 40) }
      if (detalle) linea.detalle = String(detalle).slice(0, 80)
      lista = [...lista, linea].slice(-maximo)
    },
    eventos() {
      return [...lista]
    },
    limpiar() {
      lista = []
    },
  }
}

/**
 * La bitácora de esta sesión, compartida por toda la app. Se registra desde `App.tsx` (cambio de pantalla) y
 * desde los flujos que importan (`services/errores.ts` la adjunta al error).
 */
export const bitacora = crearBitacora()
