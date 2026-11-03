/**
 * **Fechas del cliente** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Por qué existe**: los documentos se guardan con `fecha` en **ISO/UTC** (`toISOString()`), pero lo que
 * el usuario elige en un `<input type="date">` es un **día del calendario local** (`2026-10-30`). Mezclar las
 * dos cosas desplaza el día y hace desaparecer movimientos:
 *
 * 📌 **Bug del 30/10/2026 (kardex)**: el reporte hacía `new Date('2026-10-30')`, que JavaScript interpreta
 * como **medianoche UTC** (= 19:00 del día anterior en Lima) y después le aplicaba `setHours(0,0,0,0)`
 * **local**. El rango terminaba siendo el **29** de 00:00 a 23:59 y una salida de las 22:00 del 30 (que en
 * UTC es el 31 a las 03:00) quedaba **fuera**: había que elegir el día siguiente para verla.
 *
 * **La regla**: un texto `YYYY-MM-DD` se parsea **siempre** como día local, y los extremos del rango también
 * son locales (`00:00:00.000` a `23:59:59.999`). Una sola implementación: `parseDiaLocal`, `inicioDelDia`,
 * `finDelDia` y `diaLocalISO`.
 */

/** ¿El texto tiene forma `YYYY-MM-DD` (con o sin hora)? */
function esFechaISO(texto: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(texto.trim())
}

/**
 * **`YYYY-MM-DD` → `Date` a medianoche LOCAL** (`null` si no es una fecha). Es lo que hay que usar con lo
 * que devuelve un `<input type="date">`: `new Date('2026-10-30')` daría el día anterior en Lima.
 *
 * Acepta también un ISO completo (`2026-10-30T15:00:00Z`) y, en ese caso, devuelve el **día local** de ese
 * instante (que es el día en que el negocio lo vivió). Un texto inválido devuelve `null` en vez de una fecha
 * inventada.
 */
export function parseDiaLocal(valor: string | Date | null | undefined): Date | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : new Date(valor.getFullYear(), valor.getMonth(), valor.getDate())
  const texto = String(valor ?? '').trim()
  if (!texto) return null
  if (esFechaISO(texto)) {
    const [y, m, d] = texto.slice(0, 10).split('-').map(Number)
    const fecha = new Date(y, m - 1, d)
    // Un 31 de febrero se convierte solo: si no coincide, el texto no era una fecha real.
    if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) return null
    return fecha
  }
  const fecha = new Date(texto)
  if (Number.isNaN(fecha.getTime())) return null
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

/** El **primer instante** del día local de esa fecha (`00:00:00.000`). */
export function inicioDelDia(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(0, 0, 0, 0)
  return d
}

/** El **último instante** del día local de esa fecha (`23:59:59.999`): así un movimiento de las 22:00 entra. */
export function finDelDia(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(23, 59, 59, 999)
  return d
}

/**
 * **El rango de un día** listo para comparar contra `fecha` (ISO/UTC) de Firestore: los dos extremos son
 * locales y se devuelven ya en ISO, que es el formato guardado.
 */
export function rangoDelDia(desde: string | Date, hasta: string | Date): { desdeISO: string; hastaISO: string } | null {
  const inicio = parseDiaLocal(desde)
  const fin = parseDiaLocal(hasta)
  if (!inicio || !fin) return null
  // Si el usuario invierte las fechas, el rango se ordena: nunca devuelve una ventana vacía.
  const [a, b] = inicio.getTime() <= fin.getTime() ? [inicio, fin] : [fin, inicio]
  return { desdeISO: inicioDelDia(a).toISOString(), hastaISO: finDelDia(b).toISOString() }
}

/** **El día de hoy del navegador** como `YYYY-MM-DD` (lo que se pone en el `<input type="date">`). */
export function diaLocalISO(fecha: Date = new Date()): string {
  const d = new Date(fecha)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
