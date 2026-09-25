/**
 * El **latido del puente de Yape**: la señal de vida que deja el celular del negocio y que el PDV
 * lee para poder decir *«el puente está vivo»* o *«el puente no da señales»*.
 *
 * 🔑 **Por qué existe esta regla** (pedido del usuario, 22/09/2026): el puente vive en **otro
 * aparato** (el celular que recibe los yapeos) y hasta ahora el PDV no distinguía estos dos mundos:
 *
 * - **nadie yapeó** ⇒ el panel está vacío → **correcto**;
 * - **el puente se murió** (celular apagado, sin batería, el ahorrador de batería mató la app, le
 *   sacaron el permiso de notificaciones, sin internet) ⇒ el panel **también** vacío… pero **la
 *   plata entró igual**.
 *
 * Los dos se ven idénticos desde la caja, y un puente caído se descubría **al cerrar el turno**
 * (cuando el cruce dice *«hubo cobros por Yape y ningún aviso»*) o, peor, cuando el cliente reclama.
 * Con el latido, el panel avisa a los ~12 minutos y el problema se corta el mismo día.
 *
 * Lo escribe el celular (`appadm-yape-puente`: `Puente.latido()`) en `tblPuenteYape/estado`, cada
 * **5 minutos** y también cada vez que manda un aviso.
 *
 * ⚠️ **Lo que esta regla NO puede hacer**: recuperar los avisos de un rato sin puente (no hay
 * reproceso: lo que no se escribió, no está) ni reemplazar el **cruce del cierre**, que sigue siendo
 * el control real de la plata. Es un **aviso temprano**, no una garantía.
 */
import { haceCuantoYape } from './yape.ts'

/** Cada cuántos minutos late el puente (el mismo número que `Config.LATIDO_MINUTOS` del celular). */
export const LATIDO_MINUTOS = 5

/**
 * Hasta acá el silencio es **normal**: el puente puede haber latido justo antes de morir, así que
 * se le dan **dos ciclos** antes de decir que algo anda mal.
 */
export const PUENTE_DEMORADO_MINUTOS = 12

/** Pasado esto ya no es «demorado»: los avisos de ese rato **no están llegando**. */
export const PUENTE_CAIDO_MINUTOS = 30

/** Lo que el web interpreta del documento `tblPuenteYape/estado`. */
export type EstadoPuenteYape = 'activo' | 'demorado' | 'caido' | 'sin-datos'

/** El latido, tal como lo escribe el celular (todo opcional salvo la fecha: es un proceso aparte). */
export type LatidoPuenteYape = {
  /** Cuándo dio señales por última vez (ms). `0` = nunca. */
  ultimoLatido: number
  /** El **último aviso que sí mandó** (`S/ 10.00 · Alesska Pin*`), si mandó alguno. */
  ultimoAviso?: string
  /** Cuándo mandó ese aviso (ms). ⚠️ Vacío en los puentes viejos (1.2 y anteriores). */
  ultimoAvisoEn?: number
  /** Cuántos avisos mandó desde que se instaló. ⚠️ Vacío en los puentes viejos (1.2 y anteriores). */
  avisosEnviados?: number
  /** Modelo del celular (`Xiaomi Redmi Note 12`), para saber de qué teléfono habla. */
  dispositivo?: string
  /** Versión de Android. */
  android?: string
  /** Versión del puente. */
  version?: number
}

/** Minutos desde la última señal (`0` si el reloj del celular viene adelantado: nunca negativo). */
export function minutosSinSenal(latido: LatidoPuenteYape | null | undefined, ahora: number = Date.now()): number {
  const ultimo = Number(latido?.ultimoLatido) || 0
  if (ultimo <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((ahora - ultimo) / 60000))
}

/**
 * Qué está pasando con el puente, en una sola palabra.
 *
 * ⚠️ **`sin-datos` no es «caído»**: significa que el celular **nunca** escribió el latido (no se
 * instaló bien, no tiene la cuenta cargada o no tiene el permiso), y el arreglo es distinto.
 */
export function estadoDelPuente(
  latido: LatidoPuenteYape | null | undefined,
  ahora: number = Date.now(),
): EstadoPuenteYape {
  const minutos = minutosSinSenal(latido, ahora)
  if (!Number.isFinite(minutos)) return 'sin-datos'
  if (minutos >= PUENTE_CAIDO_MINUTOS) return 'caido'
  if (minutos >= PUENTE_DEMORADO_MINUTOS) return 'demorado'
  return 'activo'
}

/**
 * La línea que se muestra en el PDV (y en Configuración → Yape). Está acá, pura y testeada, para
 * que **las dos pantallas digan lo mismo**.
 */
export function textoDelPuente(
  latido: LatidoPuenteYape | null | undefined,
  ahora: number = Date.now(),
): string {
  const estado = estadoDelPuente(latido, ahora)
  const hace = haceCuantoYape(Number(latido?.ultimoLatido) || 0, ahora)
  switch (estado) {
    case 'sin-datos':
      return 'Sin datos del puente: el celular del Yape todavía no dio ninguna señal.'
    case 'activo':
      return `Puente activo · dio señales ${hace}`
    case 'demorado':
      return `El puente no da señales ${hace} (late cada ${LATIDO_MINUTOS} min)`
    default:
      return `Puente sin señal ${hace}: los yapeos de ese rato no están llegando`
  }
}

/**
 * Qué hacer con el puente, en una línea. ⚠️ **El texto es parte de la regla**: un aviso rojo sin
 * instrucción deja al cajero sin saber si tiene que llamar a alguien o puede seguir cobrando.
 */
export function recomendacionDelPuente(
  latido: LatidoPuenteYape | null | undefined,
  ahora: number = Date.now(),
): string {
  switch (estadoDelPuente(latido, ahora)) {
    case 'sin-datos':
      return 'Revisa el celular: tiene que estar encendido, con internet, con el acceso a notificaciones dado y la cuenta del puente cargada.'
    case 'activo':
      return 'Si no aparecen avisos, es que no yapeó nadie.'
    case 'demorado':
      return 'Puede ser un corte de internet del celular o que el sistema lo esté durmiendo: si sigue así, mira el celular.'
    default:
      return 'Revisa el celular del Yape antes de seguir cobrando por Yape: los avisos de este rato no entraron.'
  }
}

/**
 * El último aviso que el puente **sí** mandó.
 *
 * 🔑 Junto con el estado, es lo que distingue *«el puente está caído»* de *«el puente está vivo pero
 * no está reconociendo los avisos»* (que fue exactamente el problema del bloque ·32: dos yapeos
 * reales leídos y descartados por el texto). ⚠️ El «hace cuánto» solo se puede decir con puentes
 * **v1.3+** (`ultimoAvisoEn`): los anteriores solo guardaban el texto.
 */
export function textoUltimoAviso(
  latido: LatidoPuenteYape | null | undefined,
  ahora: number = Date.now(),
): string {
  const aviso = String(latido?.ultimoAviso ?? '').trim()
  const enviados = Number(latido?.avisosEnviados)
  if (!aviso) {
    return Number.isFinite(enviados) && enviados > 0
      ? `Mandó ${enviados} aviso(s) desde que se instaló.`
      : 'Todavía no mandó ningún aviso desde que se instaló.'
  }
  const cuando = Number(latido?.ultimoAvisoEn) || 0
  return cuando > 0
    ? `Último aviso que mandó: ${aviso} (${haceCuantoYape(cuando, ahora)})`
    : `Último aviso que mandó: ${aviso}`
}
