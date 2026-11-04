/**
 * Errores de la app — **parte pura** (sin Firebase, sin React): normalización,
 * filtro de ruido, límite de registro y captura global.
 *
 * El acceso a datos vive en `services/errores.ts`. Esta separación permite
 * **testear la lógica sin mocks** y que la capa de datos cambie sin tocar la UI.
 *
 * Convención de `contexto` (para que el registro sea legible y filtrable):
 *   `render` · `pantalla:<seccion>` · `global` · `promesa` · `<dominio>:<accion>`
 */

/** Un error tal como se guarda y se muestra. */
export type ErrorApp = {
  id?: string
  mensaje: string
  stack?: string
  /** De dónde salió: `render`, `pantalla:pdv`, `global`, `promesa`, … */
  contexto: string
  ruta?: string
  dispositivo?: string
  usuario?: string
  usuarioId?: string | null
  detalle?: Record<string, unknown>
  fecha: string
  /**
   * 🔑 **Huella del error** = `contexto` + mensaje normalizado (`huellaDeError`, `lib/observabilidad.ts`).
   * Se guarda para no recalcularla al agrupar en el panel y para que la identidad del problema sea
   * **estable entre equipos y versiones**. Los registros anteriores no la tienen: se calcula al leerlos.
   */
  huella?: string
  /**
   * **Bitácora de la sesión** en el momento del error (los últimos eventos: qué pantalla, qué buscó, qué
   * acción hizo). Es lo que explica el error; sin esto solo queda el `stack`. Nunca lleva datos del negocio.
   */
  bitacora?: string[]
}

/** Errores conocidos que no aportan nada (ruido del navegador o de librerías). */
export const PATRONES_IGNORADOS: readonly RegExp[] = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Non-Error promise rejection/i,
  /Loading chunk \d+ failed/i, // chunk viejo tras un deploy: se resuelve recargando
]

export function esRuido(mensaje: string): boolean {
  return PATRONES_IGNORADOS.some((re) => re.test(mensaje))
}

/** Convierte cualquier cosa lanzada en `{ mensaje, stack }` legibles. */
export function normalizarError(error: unknown): { mensaje: string; stack?: string } {
  if (error instanceof Error) {
    return { mensaje: error.message || error.name || 'Error', stack: error.stack }
  }
  if (typeof error === 'string') return { mensaje: error }
  if (error && typeof error === 'object') {
    const posible = error as { message?: unknown; error?: unknown }
    if (typeof posible.message === 'string' && posible.message) return { mensaje: posible.message }
    try {
      return { mensaje: JSON.stringify(error) }
    } catch {
      return { mensaje: Object.prototype.toString.call(error) }
    }
  }
  return { mensaje: String(error) }
}

/**
 * Guardia anti-inundación: como máximo `maxPorVentana` errores por ventana y
 * ninguno repetido. Si algo falla en bucle se registra **una vez**, no mil.
 *
 * El reloj es inyectable a propósito: así se puede testear sin esperar ni
 * simular `Date.now`.
 */
export function crearGuardiaErrores({
  maxPorVentana = 10,
  ventanaMs = 60_000,
  ahora = () => Date.now(),
}: { maxPorVentana?: number; ventanaMs?: number; ahora?: () => number } = {}): (clave: string) => boolean {
  const marcas: number[] = []
  const vistos = new Set<string>()

  return function permitido(clave: string): boolean {
    const t = ahora()
    while (marcas.length > 0 && t - marcas[0] > ventanaMs) marcas.shift()
    if (marcas.length >= maxPorVentana) return false
    if (vistos.has(clave)) return false
    marcas.push(t)
    vistos.add(clave)
    return true
  }
}

/**
 * Engancha los errores que **no** pasan por React: excepciones sueltas y
 * promesas rechazadas sin `catch`. Recibe el manejador por parámetro para no
 * depender de la capa de datos (inversión de dependencias).
 *
 * Devuelve una función para desengancharlos (útil en tests o HMR).
 */
export function instalarCapturaGlobal(
  onError: (error: unknown, contexto: string, detalle?: Record<string, unknown>) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window !== 'undefined' ? window : null
): () => void {
  if (!target) return () => {}

  const alFallar = (event: ErrorEvent) => {
    onError(event.error ?? event.message, 'global', { archivo: event.filename, linea: event.lineno })
  }
  const alRechazar = (event: PromiseRejectionEvent) => {
    onError(event.reason, 'promesa', {})
  }

  target.addEventListener('error', alFallar as EventListener)
  target.addEventListener('unhandledrejection', alRechazar as EventListener)
  return () => {
    target.removeEventListener('error', alFallar as EventListener)
    target.removeEventListener('unhandledrejection', alRechazar as EventListener)
  }
}

/**
 * Parte una lista en lotes del tamaño máximo que acepta una escritura de
 * Firestore (**500 operaciones**).
 *
 * Se usa para borrar/actualizar en bloque: hacerlo de a un documento son cientos
 * de viajes de ida y vuelta y, si uno falla a mitad, queda todo a medias. Un
 * tamaño inválido (0, negativo, `NaN`) se trata como 1 por lote: nunca devuelve
 * lotes vacíos ni entra en bucle.
 */
export function trocearLotes<T>(items: readonly T[], tamano = 500): T[][] {
  const n = Math.max(1, Math.floor(tamano) || 1)
  const lotes: T[][] = []
  for (let i = 0; i < items.length; i += n) lotes.push(items.slice(i, i + n))
  return lotes
}

/** Texto corto y estable para mostrar/copiar el error. */
export function resumenError(e: Pick<ErrorApp, 'mensaje' | 'contexto' | 'ruta' | 'fecha' | 'dispositivo' | 'stack'>): string {
  return [
    `Contexto: ${e.contexto}`,
    `Fecha: ${e.fecha}`,
    `Mensaje: ${e.mensaje}`,
    e.ruta ? `Ruta: ${e.ruta}` : '',
    e.dispositivo ? `Dispositivo: ${e.dispositivo}` : '',
    e.stack ? `\n${e.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
