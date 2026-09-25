/**
 * **Envío automático a SUNAT** — Firestore + la API (`opción A`, pedido del usuario 24/09/2026).
 *
 * 🔑 **La regla vive en `lib/sunat-auto.ts`** (puro y testeado: quién se manda, quién no, por qué,
 * cuándo vence, en qué orden). Acá solo se **lee**, se **reclama** y se **manda**, reusando los
 * mismos `enviarDocumentoASunat` / `enviarNotaASunat` del botón manual: **un solo camino de envío**,
 * así el envío automático no puede declarar algo distinto que el botón.
 *
 * 🔑 **Cómo se buscan los pendientes (y por qué así)**: con **una igualdad por estado** sobre
 * `sunat.estado` (`pendiente`, `error`, `enviando`). Es un **campo único ⇒ no necesita índice
 * compuesto**, y sobre todo trae **solo lo que hay que mandar** (en producción, unos pocos
 * documentos) en vez de recorrer por fecha el mes entero: el barrido corre cada 10 minutos en cada
 * pantalla abierta y cada lectura se paga.
 * ⚠️ **No se puede filtrar por `sunat.estado != 'aceptado'`** ni ordenar por un segundo campo: eso
 * sí pediría un índice declarado y desplegado (`firestore.indexes.json`), y sin él la consulta falla
 * con *«The query requires an index»*. Con igualdad simple no hace falta nada.
 *
 * 🔑 **El reclamo (`reclamarDocumentoSunat`)**: con dos pestañas abiertas —o dos equipos— las dos
 * verían el mismo comprobante `pendiente` y **las dos lo mandarían**. El reclamo lo marca `enviando`
 * **dentro de una transacción** y devuelve el documento **fresco** (lo que leyó la transacción), que
 * es con lo que se arma el payload: ni doble envío ni un payload viejo. Si la pestaña que lo tomó se
 * cierra a mitad del envío, el reclamo **caduca solo** (`MINUTOS_ENVIO_COLGADO`).
 *
 * ⚠️ **Un documento que SUNAT rechaza queda `rechazado` y NO se reintenta** (el mismo XML daría el
 * mismo rechazo): lo levanta la alerta `sunat-rechazado` para que una persona lo corrija.
 */
import { collection, doc as fsDoc, getDoc, getDocFromServer, getDocs, query, runTransaction, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { limpiarUndefined } from '@/lib/limpio'
import {
  autoEnvioSunatActivo,
  camposDeReclamoSunat,
  diasVencimientoSunat,
  elegirParaEnviarSunat,
  esNotaSunat,
  etiquetaSunat,
  pendientesDeEnvioSunat,
  puedeEnviarseSunat,
  type ConfigSunatAuto,
  type DocumentoSunat,
} from '@/lib/sunat-auto'
import { enviarDocumentoASunat, enviarNotaASunat } from '@/services/sunat'

/**
 * Los estados de `sunat` que **hay que mirar**. Los cuatro son igualdades simples sobre un campo
 * único ⇒ **sin índice compuesto**.
 *
 * ⚠️ **`rechazado` está en la lista aunque el envío automático NUNCA lo reintente**: lo que se busca
 * con esa igualdad es **la alerta** (un comprobante rechazado no está declarado y necesita que una
 * persona lo corrija), y sin consultarlo la alerta no se podía disparar **nunca**. Quién se manda y
 * quién no lo decide la regla pura (`lib/sunat-auto.ts`), no la consulta — 📌 **lo destapó la prueba
 * end-to-end**: la alerta del rechazo no aparecía.
 */
const ESTADOS_CONSULTADOS = ['pendiente', 'error', 'enviando', 'rechazado'] as const

/**
 * Presupuesto de tiempo de una pasada.
 *
 * ⚠️ Con la API caída, cada envío espera el `TIMEOUT_SUNAT` (60 s) antes de rendirse: sin este tope,
 * una pasada de 5 comprobantes tendría a la pestaña ocupada 5 minutos y la siguiente pasada llegaría
 * encima. Lo que queda se manda en la pasada siguiente (nada se pierde: lo que no se empezó sigue
 * `pendiente` y sin reclamar).
 */
const PRESUPUESTO_PASADA_MS = 120000

/** Un documento crudo de Firestore → lo que necesita la regla (nunca se inventa un campo). */
export function aDocumentoSunat(id: string, data: Record<string, unknown>): DocumentoSunat {
  const venta = (data.venta ?? {}) as Record<string, unknown>
  const sunat = (data.sunat ?? null) as Record<string, unknown> | null
  return {
    id,
    tipoDoc: String(data.tipoDoc ?? data.tipo ?? ''),
    serieNumero: String(data.serieNumero ?? ''),
    estado: String(data.estado ?? ''),
    fecha: data.fecha ?? data.createdAt,
    numero: (data.numero ?? data.correlativo ?? null) as number | null,
    serie: String(data.serie ?? ''),
    sunat: sunat
      ? {
          estado: String(sunat.estado ?? ''),
          serie: String(sunat.serie ?? ''),
          numero: (sunat.numero ?? null) as number | null,
          ultimoEnvio: sunat.ultimoEnvio,
          enviandoEn: sunat.enviandoEn,
          enviandoPor: String(sunat.enviandoPor ?? ''),
          intentos: Number(sunat.intentos) || 0,
          consolidado: sunat.consolidado,
          cdrDesc: (sunat.cdrDesc ?? null) as string | null,
          error: (sunat.error ?? null) as string | null,
        }
      : null,
    venta: {
      total: Number(venta.total) || 0,
      importe_total: Number(venta.importe_total ?? venta.total) || 0,
      cliente_nombre: String(venta.cliente_nombre ?? ''),
      documentoReferencia: String(venta.documentoReferencia ?? ''),
      docReferencia: String(venta.docReferencia ?? ''),
    },
  }
}

/**
 * Los documentos que **esperan a SUNAT** (pendientes, con error, colgados o rechazados), sin importar
 * de qué día son: un comprobante sin declarar puede tener días y el aviso tiene que verlo igual. Se
 * deduplica por id porque un documento podría aparecer en dos de las consultas si cambió de estado
 * entre una y otra.
 *
 * ⚠️ **Un fallo de lectura se propaga** (no se devuelve `[]`): devolver vacío haría que el barrido
 * creyera que no hay nada que mandar y la alerta dijera que todo está en orden justo cuando no sabe
 * nada. Es el mismo criterio de `services/alertas.ts`.
 */
export async function cargarDocumentosSunatPendientes(): Promise<DocumentoSunat[]> {
  const snaps = await Promise.all(
    ESTADOS_CONSULTADOS.map((estado) =>
      getDocs(query(collection(db, COL.DOCUMENTOS), where('sunat.estado', '==', estado))),
    ),
  )
  const porId = new Map<string, DocumentoSunat>()
  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (!porId.has(d.id)) porId.set(d.id, aDocumentoSunat(d.id, d.data() as Record<string, unknown>))
    }
  }
  return [...porId.values()]
}

/** Lo que devuelve el reclamo: si se pudo tomar y, si sí, el documento **fresco** para armar el envío. */
export type ReclamoSunat = { ok: boolean; motivo?: string; doc?: Record<string, unknown> }

/**
 * La configuración de la empresa **leída del servidor**, no de la caché.
 *
 * 🔑 **Por qué no alcanza con la config de la pantalla** (lo destapó la prueba de dos pestañas): con
 * `persistentLocalCache`, al recargar la página el listener entrega **primero el valor guardado en la
 * caché** y recién después el del servidor. Si el dueño **apagó** el envío automático un rato antes,
 * la primera pasada —que arranca en el acto— podía decidir con el valor viejo (`true`) y **mandar un
 * comprobante con el automático apagado**. Eso no es aceptable: es una acción fiscal que el negocio
 * ya había desactivado.
 *
 * ⚠️ Cuesta **una lectura por pasada** (cada 10 minutos): es el precio de decidir con el dato bueno, y
 * es más barato que el comprobante que se manda de más. La config que llega por parámetro se usa como
 * **respaldo** si el servidor no responde (sin conexión, por ejemplo).
 */
export async function configuracionFrescaSunat(): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDocFromServer(fsDoc(db, COL.CONFIGURACION, 'empresa'))
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null
  } catch (e) {
    console.warn('⚠️ No se pudo leer la configuración del servidor; se usa la de la pantalla:', (e as Error).message)
    return null
  }
}

/**
 * **Toma** un documento para mandarlo (transaccional y cross-pestaña).
 *
 * 🔑 El documento se revisa **dentro de la transacción** con la regla pura: si otro equipo ya lo mandó
 * (quedó `aceptado`), si lo tomó otra pestaña hace un minuto (`enviando`) o si pasó el plazo
 * (`vencido`), acá se corta y `ok: false`. Así el barrido no puede mandar de más aunque dos pantallas
 * corran a la vez.
 */
export async function reclamarDocumentoSunat(
  documentoId: string,
  opciones: { dispositivo?: string; ahora?: number; dias?: number } = {},
): Promise<ReclamoSunat> {
  const docRef = fsDoc(db, COL.DOCUMENTOS, documentoId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef)
    if (!snap.exists()) return { ok: false, motivo: 'no-existe' }
    const datos = snap.data() as Record<string, unknown>
    const actual = aDocumentoSunat(documentoId, datos)
    if (!puedeEnviarseSunat(actual, opciones)) return { ok: false, motivo: 'ya-no-corresponde' }
    tx.update(docRef, limpiarUndefined({ sunat: camposDeReclamoSunat(actual, opciones) }))
    return { ok: true, doc: datos }
  })
}

/**
 * ¿El comprobante que esta nota modifica **todavía no está aceptado**?
 *
 * 🔑 **Por qué se espera**: una NC/ND se declara **contra un comprobante** que SUNAT tiene que conocer
 * primero; si se manda antes, la rechaza. En una pasada los comprobantes van **delante** de las notas
 * (`elegirParaEnviarSunat`), así que esto cubre el caso de la nota cuya boleta todavía no se declaró.
 *
 * ⚠️ **Fail-open, a propósito**: si no se encuentra el original (o la lectura falla) **se manda** —
 * es lo mismo que hace el botón manual hoy, y SUNAT tiene la última palabra. Lo que no se hace es
 * mandarla cuando se **sabe** que el original no está aceptado: eso sería un rechazo anunciado.
 */
async function originalSinAceptarSunat(doc: DocumentoSunat): Promise<boolean> {
  const referencia = String(doc.venta?.documentoReferencia || doc.venta?.docReferencia || '').trim()
  if (!referencia) return false
  try {
    const snap = await getDocs(
      query(collection(db, COL.DOCUMENTOS), where('serieNumero', '==', referencia)),
    )
    if (snap.empty) return false
    return !snap.docs.some((d) => {
      const datos = d.data() as Record<string, unknown>
      const bloque = (datos.sunat ?? {}) as Record<string, unknown>
      return String(bloque.estado ?? '') === 'aceptado'
    })
  } catch (e) {
    console.warn('⚠️ No se pudo verificar el comprobante original de la nota:', (e as Error).message)
    return false
  }
}

/**
 * En qué estado quedó el envío de un documento **según la base** (no según el mensaje del envío).
 *
 * 🔑 **Por qué hace falta**: un envío que falla devuelve `success: false` tanto si SUNAT **rechazó**
 * el comprobante como si la API no respondió, y la diferencia es grande — un **rechazo** no se
 * reintenta nunca (el mismo XML daría el mismo rechazo) y necesita que alguien lo corrija. Se mira el
 * documento, que es la fuente de verdad. Cuesta una lectura y **solo pasa cuando algo falló**.
 */
async function leerEstadoSunat(documentoId: string): Promise<string> {
  try {
    const snap = await getDoc(fsDoc(db, COL.DOCUMENTOS, documentoId))
    if (!snap.exists()) return ''
    const datos = snap.data() as Record<string, unknown>
    const bloque = (datos.sunat ?? {}) as Record<string, unknown>
    return String(bloque.estado ?? '')
  } catch (e) {
    console.warn('⚠️ No se pudo leer el estado SUNAT del documento:', (e as Error).message)
    return ''
  }
}

/** Qué pasó en una pasada. La pantalla lo usa para avisar **solo** de lo que hay que mirar. */
export type ResultadoSunatAuto = {
  /** Cuántos pendientes había antes de empezar (el mismo número que muestra la alerta). */
  esperando: number
  enviados: number
  aceptados: number
  /** SUNAT los rechazó: no se reintentan solos y necesitan que alguien los corrija. */
  rechazados: number
  /** No se pudo declarar por otra razón (API caída, timeout, dato incompleto). */
  conError: number
  /** Los que no se pudieron mandar solos (vencidos, ya en envío, esperando al original, sin correlativo). */
  omitidos: number
  /** Detalle por documento, para el aviso y para el log. */
  detalle: { id: string; etiqueta: string; ok: boolean; mensaje?: string }[]
  /** Se dejó de mandar por presupuesto de tiempo (lo que falta va en la próxima pasada). */
  cortadoPorTiempo: boolean
  /** La pasada **no hizo nada** porque el envío automático está apagado en la configuración. */
  apagado: boolean
}

/**
 * **Una pasada del barrido**: mira lo pendiente, elige lo que se puede mandar **solo**, lo reclama y
 * lo manda **de a uno** (en orden: comprobantes antes que notas, el que vence primero adelante).
 *
 * ⚠️ **Nunca lanza por un envío fallido**: un comprobante que SUNAT rechaza no puede cortar la pasada
 * (los demás se tienen que mandar igual). Solo se propaga el fallo de la **lectura** inicial, que es
 * el único caso en el que no hay nada que hacer.
 */
export async function enviarPendientesSunatAutomatico(
  opciones: {
    config?: Record<string, unknown> | null
    /**
     * `true` (por defecto) **respeta el interruptor** `sunatAutoEnvio`: es el barrido automático.
     * El botón manual pasa `false` — tiene que mandar **con el automático apagado**, que es justo para
     * lo que existe.
     */
    respetarInterruptor?: boolean
    ahora?: number
    dispositivo?: string
    maxPorPasada?: number
    presupuestoMs?: number
  } = {},
): Promise<ResultadoSunatAuto> {
  const respetar = opciones.respetarInterruptor !== false
  const ahora = opciones.ahora ?? Date.now()

  // 🔑 La config se lee **del servidor** (ver `configuracionFrescaSunat`): el interruptor y los datos
  // fiscales del payload no pueden salir de un valor cacheado.
  const fresca = await configuracionFrescaSunat()
  const config = { ...(opciones.config ?? {}), ...(fresca ?? {}) }
  // La config llega como documento crudo de Firestore: los helpers puros leen solo sus campos.
  const cfg = config as ConfigSunatAuto
  if (respetar && !autoEnvioSunatActivo(cfg)) {
    // El negocio lo apagó: no se manda nada solo (el resultado lo dice, para poder mostrarlo).
    return { esperando: 0, enviados: 0, aceptados: 0, rechazados: 0, conError: 0, omitidos: 0, detalle: [], cortadoPorTiempo: false, apagado: true }
  }

  const dias = diasVencimientoSunat(cfg)
  const presupuesto = opciones.presupuestoMs ?? PRESUPUESTO_PASADA_MS

  const docs = await cargarDocumentosSunatPendientes()
  const esperando = pendientesDeEnvioSunat(docs, { ahora, dias }).length
  const candidatos = elegirParaEnviarSunat(docs, { ahora, dias, max: opciones.maxPorPasada })

  const resultado: ResultadoSunatAuto = {
    esperando,
    enviados: 0,
    aceptados: 0,
    rechazados: 0,
    conError: 0,
    omitidos: esperando - candidatos.length,
    detalle: [],
    cortadoPorTiempo: false,
    apagado: false,
  }
  if (candidatos.length === 0) return resultado

  const inicio = Date.now()
  for (const candidato of candidatos) {
    if (Date.now() - inicio > presupuesto) {
      resultado.cortadoPorTiempo = true
      break
    }

    // Una nota espera a su comprobante: si el original todavía no está aceptado, se deja para la
    // próxima pasada (en esta, los comprobantes van primero y ya se habrán mandado).
    if (esNotaSunat(candidato) && (await originalSinAceptarSunat(candidato))) {
      resultado.omitidos += 1
      resultado.detalle.push({
        id: candidato.id,
        etiqueta: etiquetaSunat(candidato),
        ok: false,
        mensaje: 'Espera a que su comprobante esté aceptado por SUNAT.',
      })
      continue
    }

    const reclamo = await reclamarDocumentoSunat(candidato.id, {
      dispositivo: opciones.dispositivo,
      ahora,
      dias,
    })
    if (!reclamo.ok || !reclamo.doc) {
      // Otra pestaña lo tomó, o ya no corresponde (lo aceptaron / lo anularon / venció): no es un error.
      resultado.omitidos += 1
      continue
    }

    // 🔑 Se manda el documento **fresco** (el que leyó la transacción): el payload sale del estado
    // real, no del que había cuando se listó.
    const fresco = { id: candidato.id, ...reclamo.doc }
    const esNota = esNotaSunat(candidato)
    let r: { success: boolean; message?: string; error?: string; yaAceptado?: boolean }
    try {
      r = esNota ? await enviarNotaASunat(fresco, config) : await enviarDocumentoASunat(fresco, config)
    } catch (e) {
      // `enviarDocumentoASunat` ya atrapa sus errores; esto es la red por si algo se escapa (no puede
      // tumbar la pasada entera y dejar sin mandar los que siguen).
      r = { success: false, error: (e as Error).message }
    }

    resultado.enviados += 1
    if (r.success) {
      resultado.aceptados += 1
    } else if (r.yaAceptado) {
      resultado.omitidos += 1
    } else {
      // Un fallo puede ser un **rechazo de SUNAT** o un problema de conexión, y la diferencia importa
      // (el rechazo no se reintenta nunca y pide que una persona corrija el comprobante). El mensaje
      // del envío no los distingue: la fuente de verdad es el estado que quedó en el documento.
      const estado = await leerEstadoSunat(candidato.id)
      if (estado === 'rechazado') resultado.rechazados += 1
      else resultado.conError += 1
    }
    resultado.detalle.push({
      id: candidato.id,
      etiqueta: etiquetaSunat(candidato),
      ok: Boolean(r.success),
      mensaje: r.message || r.error,
    })
  }

  return resultado
}
