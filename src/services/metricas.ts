import { collection, doc, getDoc, getDocs, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { ejecutarTransaccion } from '@/services/transacciones'
import { METRICAS_WEB, campoDeMetrica, diaDeHoy, type DiaDeMetricas, type MetricaWeb } from '@/lib/observabilidad'

/**
 * 🔑 **Métricas de uso y rendimiento (`tblMetricas`), agregadas por día.**
 *
 * 📌 **Por qué existe** (03/11/2026): el rendimiento estaba medido **a mano y una vez** (los 23-46 ms del
 * catálogo paginado) y los errores eran documentos sueltos sin serie. Acá se guarda **un documento por día**
 * con sumas y contadores, así el panel puede mostrar tendencia sin leer miles de documentos ni pagar
 * lecturas de más.
 *
 * **Decisiones que importan:**
 * - **Un documento por día local** (`YYYY-MM-DD`, regla en `lib/observabilidad.ts`): el día del negocio, no
 *   UTC — un turno de las 21:00 pertenece a ese día.
 * - **Sumas + muestras**, no promedios: promediar en el cliente permite recalcular después. Y se guarda el
 *   **peor** valor del día, porque el promedio esconde un pico de 9 s.
 * - ⚠️ **Escriben todos los equipos abiertos**, así que la escritura tiene que ser **atómica por campo**:
 *   los contadores van con `increment()` y el «peor» va por transacción (`ejecutarTransaccion`, regla del
 *   repo) porque necesita leer para comparar. Nunca se hace read-modify-write a mano: dos cajas escribirían
 *   lo mismo y uno de los dos valores se perdería.
 * - **Nunca lanza**: una métrica que falla no puede romper una venta. Se avisa por consola y se sigue.
 */

/** Lo que mide una visita: los Web Vitals disponibles (puede faltar alguno según el navegador). */
export type MedidasWeb = Partial<Record<MetricaWeb, number>>

/**
 * Guarda las medidas de esta visita en el documento del día.
 * `muestras` cuenta **visitas**, no métricas: es el denominador de los promedios.
 */
export async function registrarMetricas(medidas: MedidasWeb, opciones?: { lcpElemento?: string }): Promise<void> {
  const dia = diaDeHoy()
  const ref = doc(db, COL.METRICAS, dia)
  const limpio: MedidasWeb = {}
  for (const m of METRICAS_WEB) {
    const v = medidas[m]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) limpio[m] = v
  }
  if (Object.keys(limpio).length === 0) return

  try {
    // Transacción: hay que leer el «peor» del día para comparar. Las sumas y `muestras` se pueden hacer en
    // la misma escritura sin riesgo de pisar a otra caja (se recalcula sobre lo leído dentro del lock).
    await ejecutarTransaccion(db, async (tx) => {
      const snap = await tx.get(ref)
      const previo = (snap.exists() ? snap.data() : {}) as Record<string, unknown>
      const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

      const payload: Record<string, unknown> = {
        fecha: Timestamp.now(),
        dia,
        muestras: numero(previo.muestras) + 1,
        actualizado: new Date().toISOString(),
      }
      // Sobre qué elemento se midió el LCP (último valor del día): sirve para leer si mide el armazón.
      const elemento = opciones?.lcpElemento?.trim()
      if (elemento) payload.lcp_elemento = elemento.slice(0, 60)
      for (const m of METRICAS_WEB) {
        const v = limpio[m]
        if (v === undefined) continue
        const campoSuma = campoDeMetrica(m, 'suma')
        const campoPeor = campoDeMetrica(m, 'peor')
        payload[campoSuma] = numero(previo[campoSuma]) + v
        payload[campoPeor] = Math.max(numero(previo[campoPeor]), v)
      }
      tx.set(ref, payload, { merge: true })
    }, 'guardar métricas del día')
  } catch (e) {
    // Degradar en silencio (con rastro): las métricas no son parte de la venta.
    console.warn('⚠️ No se pudieron guardar las métricas:', e)
  }
}

/** Lee los últimos `dias` documentos (uno por día) para el panel. Sin índice compuesto: un solo `orderBy`. */
export async function obtenerMetricas(dias = 14): Promise<DiaDeMetricas[]> {
  try {
    const snap = await getDocs(query(collection(db, COL.METRICAS), orderBy('fecha', 'desc'), fsLimit(Math.max(1, dias))))
    return snap.docs
      .map((d) => ({ ...(d.data() as Omit<DiaDeMetricas, 'id'>), id: d.id }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.id))
  } catch (e) {
    console.error('❌ No se pudieron leer las métricas:', e)
    return []
  }
}

/** El documento de hoy (o `null`). Sirve para «¿se está midiendo?» en el panel. */
export async function metricasDeHoy(): Promise<DiaDeMetricas | null> {
  try {
    const snap = await getDoc(doc(db, COL.METRICAS, diaDeHoy()))
    if (!snap.exists()) return null
    return { ...(snap.data() as Omit<DiaDeMetricas, 'id'>), id: snap.id }
  } catch {
    return null
  }
}
