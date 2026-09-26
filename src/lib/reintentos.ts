/**
 * **Reintentos ante contención de Firestore** — la parte pura (sin Firebase, sin React).
 *
 * 🔑 **Qué problema resuelve**: cuando dos cajas tocan **el mismo documento** al mismo tiempo —el caso
 * más común es vender **el mismo producto** en las tres cajas a la vez— Firestore responde
 * `ABORTED: Transaction lock timeout`. El SDK ya reintenta por su cuenta unas cuantas veces, pero
 * cuando se rinde **el error llegaba crudo a la pantalla del cajero** (*«aborted: Transaction lock
 * timeout»*, en inglés) y la venta quedaba sin cobrar. Eso pasaba por **contención, no por datos**: la
 * transacción es atómica, así que **volver a intentarla entera es seguro** (o se aplica todo, o nada).
 *
 * 🔑 **Este módulo es la REGLA ÚNICA** de la decisión: **qué error es transitorio** (vale la pena
 * reintentar) y **qué error es definitivo** (reintentar no cambia nada y hay que decirle la verdad al
 * usuario). Lo usan `services/transacciones.ts` (el envoltorio que reintenta) y los servicios que
 * arman el mensaje.
 *
 * ⚠️ **Lo que NO se reintenta, a propósito**: un error de negocio (`Stock insuficiente`, `La venta ya
 * no está pendiente`), un permiso denegado, o **la falta de un índice** — `failed-precondition` es el
 * código de *«The query requires an index»*: reintentarlo daría el mismo error para siempre y taparía
 * el problema real (bloque ·5 del historial).
 */

/** Códigos de Firestore que significan «volvé a intentar» (contención, red, cuota transitoria). */
export const CODIGOS_TRANSITORIOS: readonly string[] = [
  'aborted', // contención: dos transacciones sobre el mismo documento (el caso de este módulo)
  'unavailable', // la conexión se cortó en el medio
  'deadline-exceeded', // se pasó el tiempo de espera
  'resource-exhausted', // límite de tasa del proyecto
  'cancelled',
  'unknown', // Firestore lo usa para fallos de red sin más detalle
]

/**
 * Señales en el **texto** del error, para cuando el `code` no alcanza. Son los textos que usa el SDK.
 *
 * ⚠️ **`failed-precondition` es ambiguo** (lo destapó la prueba de contención real): Firestore usa ese
 * MISMO código para dos cosas opuestas —
 *   · *«the stored version … does not match the required base version»*: alguien tocó el documento entre
 *     la lectura y la escritura ⇒ **transitorio**, hay que reintentar;
 *   · *«The query requires an index»*: falta declarar un índice ⇒ **definitivo** (bloque ·5).
 * Por eso el código no decide solo: manda el texto (y la falta de índice se descarta primero).
 */
export const PATRONES_TRANSITORIOS: readonly RegExp[] = [
  /transaction lock timeout/i,
  /too much contention/i,
  /stored version .*does not match|does not match the required base version/i,
  /the transaction has too many pending/i,
  /timed out|timeout/i,
  /network|offline|unavailable|failed to fetch|connection/i,
  /aborted/i,
]

/**
 * Errores de **configuración**: no se arreglan reintentando y hay que decirle la verdad al usuario (o al
 * admin). Se evalúan **antes** que los transitorios, porque el código `failed-precondition` es el mismo.
 */
export const PATRONES_DEFINITIVOS: readonly RegExp[] = [
  /requires an index|create it here|the query requires/i, // falta un índice declarado (bloque ·5)
]

/** El `code` del error, en minúsculas y sin espacios (`'ABORTED'` → `'aborted'`). `''` si no hay. */
export function codigoDeError(e: unknown): string {
  const posible = e as { code?: unknown; name?: unknown } | null
  const crudo = typeof posible?.code === 'string' ? posible.code : typeof posible?.name === 'string' ? posible.name : ''
  return crudo.trim().toLowerCase()
}

/** El texto del error, sin inventar: `''` si no se puede leer. */
export function textoDeError(e: unknown): string {
  if (!e) return ''
  if (typeof e === 'string') return e
  const posible = e as { message?: unknown; error?: unknown } | null
  if (typeof posible?.message === 'string') return posible.message
  if (typeof posible?.error === 'string') return posible.error
  return ''
}

/**
 * **¿Vale la pena reintentar?** Primero se descartan los errores de **configuración** (falta de índice),
 * después decide el **código** (es lo confiable) y al final el **texto**, que es lo único que distingue
 * los dos usos de `failed-precondition` (ver `PATRONES_TRANSITORIOS`).
 */
export function esErrorTransitorio(e: unknown): boolean {
  const texto = textoDeError(e)
  if (texto && PATRONES_DEFINITIVOS.some((re) => re.test(texto))) return false
  const codigo = codigoDeError(e)
  if (CODIGOS_TRANSITORIOS.includes(codigo)) return true
  if (!texto) return false
  return PATRONES_TRANSITORIOS.some((re) => re.test(texto))
}

/**
 * **El mensaje que ve el cajero** cuando, después de reintentar, la contención sigue.
 *
 * 🔑 Dice **qué hacer** (*reintentar*) y **por qué** (*varias cajas a la vez*), sin el inglés del SDK ni
 * el código crudo — que igual queda en la consola y en el Panel de Errores para poder diagnosticarlo.
 * ⚠️ **No promete que la venta se cobró**: si llegó hasta acá, la transacción **no se aplicó** (es
 * atómica), así que el carrito sigue intacto y reintentar es seguro y no duplica nada.
 */
export function mensajeSistemaOcupado(etiqueta?: string): string {
  const cola = etiqueta ? ` (${etiqueta})` : ''
  return `El sistema está ocupado${cola}: hay varias cajas trabajando al mismo tiempo. Reintenta en un momento — no se registró nada.`
}

/** Cuántos reintentos extra se hacen por defecto (además del intento original). */
export const REINTENTOS_POR_DEFECTO = 3
/** Espera base del primer reintento (ms). Crece al doble en cada uno. */
export const ESPERA_BASE_MS = 400
/** Tope de la espera entre reintentos (ms). */
export const ESPERA_MAXIMA_MS = 2500

/**
 * **Cuánto esperar antes del reintento `intento`** (1 = el primero): 400, 800, 1600… con tope.
 *
 * 🔑 **Con temblor (jitter)**: si las tres cajas reintentan exactamente al mismo tiempo, vuelven a
 * chocar. El factor aleatorio (entre la mitad y el total) las despega. `aleatorio` es inyectable para
 * poder testear el número exacto.
 */
export function esperaDeReintento(
  intento: number,
  opciones: { baseMs?: number; maxMs?: number; aleatorio?: () => number } = {},
): number {
  const base = opciones.baseMs ?? ESPERA_BASE_MS
  const max = opciones.maxMs ?? ESPERA_MAXIMA_MS
  const aleatorio = opciones.aleatorio ?? Math.random
  const n = Math.max(1, Math.floor(Number(intento) || 1))
  const ideal = Math.min(max, base * 2 ** (n - 1))
  const factor = 0.5 + Math.min(1, Math.max(0, aleatorio())) * 0.5
  return Math.round(ideal * factor)
}

/**
 * **Ejecuta `fn` y la reintenta si el error es transitorio.**
 *
 * Devuelve lo que devuelva `fn` en el primer intento que salga bien. Si se agotan los intentos,
 * **lanza el último error tal cual** (el envoltorio de `services/transacciones.ts` decide si lo cambia
 * por el mensaje de «sistema ocupado»). Un error **no** transitorio se lanza en el acto, sin
 * reintentar: reintentar un error de negocio solo hace esperar al cajero para el mismo resultado.
 *
 * ⚠️ `dormir` es inyectable: así el reintento se prueba **sin esperar** de verdad.
 */
export async function conReintentos<T>(
  fn: (intento: number) => Promise<T>,
  opciones: {
    reintentos?: number
    dormir?: (ms: number) => Promise<void>
    alReintentar?: (error: unknown, intento: number, esperaMs: number) => void
    esperaBaseMs?: number
    esperaMaxMs?: number
    aleatorio?: () => number
  } = {},
): Promise<T> {
  const reintentos = Math.max(0, Math.floor(opciones.reintentos ?? REINTENTOS_POR_DEFECTO))
  const dormir = opciones.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let ultimo: unknown
  for (let intento = 1; intento <= reintentos + 1; intento++) {
    try {
      return await fn(intento)
    } catch (e) {
      ultimo = e
      if (!esErrorTransitorio(e) || intento > reintentos) break
      const espera = esperaDeReintento(intento, {
        baseMs: opciones.esperaBaseMs,
        maxMs: opciones.esperaMaxMs,
        aleatorio: opciones.aleatorio,
      })
      opciones.alReintentar?.(e, intento, espera)
      await dormir(espera)
    }
  }
  throw ultimo
}
