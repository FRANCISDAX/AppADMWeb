/**
 * Quién vendió y quién cobró — **módulo puro** (sin imports, testeable con el runner nativo
 * de Node: `npm test`).
 *
 * En este negocio una venta puede pasar por **dos personas**:
 *
 *   - **Vendedor**: arma la venta en el PDV y la manda a caja (queda `PED-000123`).
 *   - **Cajero**: elige el comprobante, cobra y cierra el turno.
 *
 * Cuando trabaja **una sola persona** (el cajero vende y cobra), los documentos guardan el
 * mismo nombre en los dos campos: `registrarVenta` escribe `cajero` y `vendedorNombre` con el
 * usuario logueado. Por eso la regla acá no es "mostrar los dos campos" sino **"mostrar a las
 * dos personas"**: si el nombre es el mismo, es una sola y no se repite en el papel.
 *
 * De dónde sale cada nombre (por orden de confianza):
 *   - cajero: `cajero` → `venta.cajero` → `usuarioNombre`
 *   - vendedor: `vendedorNombre` → `vendedor`
 *
 * ⚠️ Un pedido cobrado guarda el vendedor dentro de `venta.cajero` (lo escribió el vendedor al
 * mandarlo a caja) y al cajero en el campo `cajero` del documento. Por eso el orden importa:
 * si se leyera `venta.cajero` primero, el comprobante diría que el vendedor cobró.
 */

export type Personal = { vendedor: string; cajero: string }

/** Fuente laxa a propósito: documentos viejos, items de turno y pedidos tienen formas distintas. */
export type FuentePersonal = {
  cajero?: unknown
  vendedorNombre?: unknown
  vendedor?: unknown
  usuarioNombre?: unknown
  venta?: { cajero?: unknown } | null
}

const limpio = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Dos nombres son la misma persona si coinciden salvo mayúsculas y espacios. */
export function mismoNombre(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Nombres a imprimir de una venta, un comprobante o un item de turno.
 * Devuelve `''` en el campo que no corresponda: **nunca inventa un nombre**.
 */
export function personalDeVenta(fuente?: FuentePersonal | null): Personal {
  if (!fuente || typeof fuente !== 'object') return { vendedor: '', cajero: '' }

  const cajero = limpio(fuente.cajero) || limpio(fuente.venta?.cajero) || limpio(fuente.usuarioNombre)
  let vendedor = limpio(fuente.vendedorNombre) || limpio(fuente.vendedor)

  // Una sola persona (venta directa del cajero): el mismo nombre en los dos campos no es un
  // vendedor distinto, así que no se imprime dos veces.
  if (vendedor && cajero && mismoNombre(vendedor, cajero)) vendedor = ''

  return { vendedor, cajero }
}

/** Líneas rotuladas para los documentos: vendedor primero (si lo hay), después el cajero. */
export function lineasPersonal(personal: Personal): { etiqueta: string; nombre: string }[] {
  const lineas: { etiqueta: string; nombre: string }[] = []
  if (personal.vendedor) lineas.push({ etiqueta: 'Vendedor', nombre: personal.vendedor })
  if (personal.cajero) lineas.push({ etiqueta: 'Cajero', nombre: personal.cajero })
  return lineas
}

/** Una línea de texto con ambos nombres (`Vendedor: Ana · Cajero: Luis`), o `''` si no hay ninguno. */
export function textoPersonal(personal: Personal, separador = ' · '): string {
  return lineasPersonal(personal)
    .map((l) => `${l.etiqueta}: ${l.nombre}`)
    .join(separador)
}
