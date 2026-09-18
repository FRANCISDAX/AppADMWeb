/**
 * Limpieza de datos antes de escribir en Firestore — **módulo puro** (sin imports, testeable con
 * `npm test`).
 *
 * ⚠️ **Firestore RECHAZA `undefined`**: no lo ignora, tira
 * *"Function transaction.set() called with invalid data. Unsupported field value: undefined"*.
 * Y TypeScript **no ayuda**: un campo opcional tipado `string | undefined` compila perfecto y
 * explota recién al escribir, en producción y en la cara del usuario.
 *
 * Así nació el bug del flujo de pedidos (17/09/2026): el PDV mandaba
 * `descuentoGlobalTipo: descuentoGlobalValor ? tipo : undefined` y `crearVentaPendiente` guardaba
 * `envio: venta.envio` (que tampoco venía) → **enviar a caja fallaba siempre**. Había **0 pedidos**
 * en producción porque nunca funcionó, y el `tsc` en verde no dijo nada.
 *
 * Este helper es la red de seguridad en el borde de escritura:
 *
 * ```ts
 * tx.set(ref, limpiarUndefined(docData))
 * ```
 *
 * **Qué hace**: borra las propiedades con `undefined` (recursivo) y descarta los `undefined`
 * sueltos dentro de arrays (Firestore también los rechaza). **Qué NO toca**: `null` (es un valor
 * válido y con significado: "vacío a propósito"), `false`, `0`, `''`, `Date`, `Timestamp` y los
 * centinelas de Firestore (`increment()`, `serverTimestamp()`), que son instancias de clase y se
 * devuelven tal cual.
 *
 * ⚠️ **No reemplaza arreglar el origen**: un campo que no debería faltar sigue siendo un bug de
 * datos; esto evita que la venta **falle**, no que el dato esté bien.
 */

/** Solo se limpian objetos "planos" (literales); las instancias de clase se respetan. */
function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Devuelve una copia sin valores `undefined` (recursivo). No muta la entrada.
 */
export function limpiarUndefined<T>(valor: T): T {
  if (Array.isArray(valor)) {
    const limpio = valor.filter((v) => v !== undefined).map((v) => limpiarUndefined(v))
    return limpio as unknown as T
  }
  if (!esObjetoPlano(valor)) return valor

  const salida: Record<string, unknown> = {}
  for (const [clave, v] of Object.entries(valor)) {
    if (v === undefined) continue
    salida[clave] = limpiarUndefined(v)
  }
  return salida as T
}

/**
 * ¿Quedó algún `undefined` que Firestore rechazaría? Sirve para **diagnosticar** (por ejemplo,
 * loguear el camino exacto antes de escribir) sin tener que esperar el error críptico.
 * Devuelve la ruta del primero que encuentra, o `''` si está limpio.
 */
export function rutaConUndefined(valor: unknown, ruta = ''): string {
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) {
      if (valor[i] === undefined) return `${ruta}[${i}]`
      const sub = rutaConUndefined(valor[i], `${ruta}[${i}]`)
      if (sub) return sub
    }
    return ''
  }
  if (!esObjetoPlano(valor)) return ''
  for (const [clave, v] of Object.entries(valor)) {
    const camino = ruta ? `${ruta}.${clave}` : clave
    if (v === undefined) return camino
    const sub = rutaConUndefined(v, camino)
    if (sub) return sub
  }
  return ''
}
