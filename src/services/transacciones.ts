/**
 * **Transacciones de Firestore con reintento ante contención.**
 *
 * 🔑 **Qué reemplaza y por qué**: `ejecutarTransaccion(db, fn, etiqueta)` tiene **la misma forma** que
 * `runTransaction(db, fn)` de Firestore, así que en los servicios se cambia **una sola palabra** y
 * todos los caminos transaccionales quedan protegidos. Cuando dos cajas tocan el mismo documento a la
 * vez —lo típico es **el mismo producto en las tres cajas**— Firestore contesta
 * `ABORTED: Transaction lock timeout`; antes ese texto **llegaba crudo al cajero** y la venta no se
 * cobraba.
 *
 * 🔑 **Por qué es seguro reintentar una transacción entera**: es **atómica**. O se aplicó completa, o
 * no se aplicó nada; no hay estado intermedio que duplicar. Firestore además valida las versiones de
 * los documentos leídos antes de confirmar, así que un reintento sobre datos que cambiaron **vuelve a
 * leer y recalcula** (el correlativo, el stock, el promedio). Reintentar **no puede** emitir dos
 * comprobantes ni descontar stock dos veces.
 *
 * ⚠️ **Lo que decide el reintento es `lib/reintentos.ts`** (puro y testeado): acá solo se conecta con
 * el SDK, se deja el rastro en la consola y, si la contención **persiste**, se cambia el error técnico
 * por uno que el cajero entienda (*«El sistema está ocupado… Reintenta en un momento»*).
 * ⚠️ Un error de **negocio** (stock insuficiente, la venta ya no está pendiente) o de **configuración**
 * (falta un índice) **no** se reintenta y **no** se maquilla: se lanza tal cual.
 */
import { runTransaction, type Firestore, type Transaction } from 'firebase/firestore'
import { codigoDeError, conReintentos, esErrorTransitorio, mensajeSistemaOcupado, textoDeError } from '@/lib/reintentos'

/** Error con el mensaje de «sistema ocupado» para el usuario, conservando el código para diagnosticar. */
export type ErrorOcupado = Error & { code?: string; causa?: unknown }

export async function ejecutarTransaccion<T>(
  db: Firestore,
  fn: (tx: Transaction) => Promise<T>,
  /** Para el **log** (qué operación era). Si no se pasa, el texto genérico alcanza para diagnosticar. */
  etiqueta = '',
): Promise<T> {
  const donde = etiqueta || 'una transacción'
  try {
    return await conReintentos<T>(() => runTransaction(db, fn), {
      alReintentar: (e, intento, esperaMs) => {
        // El rastro técnico queda en la consola (y en el Panel de Errores): el usuario no lo ve, pero
        // quien diagnostica sí necesita el código y cuántas veces se reintentó.
        console.warn(
          `⚠️ Contención en ${donde}: ${codigoDeError(e) || 'sin código'} (${textoDeError(e) || 'sin detalle'}). ` +
            `Reintento ${intento} en ${esperaMs} ms.`,
        )
      },
    })
  } catch (e) {
    if (!esErrorTransitorio(e)) throw e
    // Se agotaron los reintentos y la contención sigue: el cajero recibe un mensaje en castellano y con
    // una instrucción. **No se pierde nada**: la transacción no se aplicó (por eso puede reintentar).
    console.error(
      `❌ ${donde}: no se pudo completar por contención después de reintentar (${codigoDeError(e) || 'sin código'}: ${textoDeError(e)})`,
    )
    const ocupado = new Error(mensajeSistemaOcupado(etiqueta)) as ErrorOcupado
    ocupado.code = codigoDeError(e) || undefined
    ocupado.causa = e
    throw ocupado
  }
}
