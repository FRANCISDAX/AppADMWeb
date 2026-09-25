/**
 * **Envío automático a SUNAT** (opción A — pedido del usuario, 24/09/2026).
 *
 * 🔑 **Qué problema resuelve**: un comprobante electrónico **no tiene calidad de factura** hasta que
 * SUNAT devuelve el CDR, y el plazo lo pone la norma (la factura: **3 días calendario**; la boleta:
 * 7). Hasta hoy el envío dependía de que **una persona** entrara a `Reportes → Registro SUNAT` y
 * apretara *Enviar* comprobante por comprobante: si nadie entraba, el comprobante quedaba
 * `pendiente` **para siempre** y el negocio se enteraba tarde (o nunca).
 *
 * 🔑 **Este módulo es la REGLA ÚNICA**: quién se puede enviar, quién no y **por qué**, cuándo vence,
 * en qué orden se manda y qué se avisa. Lo usan `services/sunat-auto.ts` (el barrido), el hook
 * `use-sunat-auto.ts` (el ciclo) y las alertas (`lib/alertas.ts`). Ninguna pantalla decide por su
 * cuenta.
 *
 * ⚠️ **El botón manual NO cambia**: sigue mandando cualquier comprobante cuando la persona lo pide
 * (es su decisión y su responsabilidad). Estas reglas gobiernan **solo el envío automático**, que
 * corre sin nadie mirando y por eso tiene que ser conservador.
 *
 * 🔑 **Lo que NO se manda nunca solo** (y el porqué):
 * - **Notas de venta (`NV`) y pedidos (`PENDIENTE`)**: no van a SUNAT (una NV se declara consolidada
 *   en una boleta; un pedido todavía no es un comprobante).
 * - **Lo ya `aceptado`** (ni se reintenta: ya está declarado) y **lo `rechazado`** por SUNAT (eso
 *   necesita una persona: corregir y reemitir, no insistir con el mismo XML).
 * - **Lo anulado** (`estado: 'anulada'`): el comprobante se emitió y se anuló; mandarlo declararía
 *   algo que el negocio ya dio de baja.
 * - **Lo que pasó el plazo**: si la factura ya venció, mandarla sola **no la arregla** (la norma le
 *   niega la calidad de factura electrónica) ⇒ se avisa para que una persona decida (enviarla igual,
 *   anularla o emitir una nota). **Ese documento se puede seguir mandando a mano**, como siempre.
 *
 * ⚠️ **Un fallo de red no pierde el comprobante**: un envío que se cortó queda en `error` y se
 * reintenta **como muy seguido cada `MINUTOS_ENTRE_REINTENTOS`** (sin ese freno, un comprobante roto
 * golpearía la API cada pasada). El código **1033** (*«el comprobante ya fue registrado»*) lo trata
 * el envío como **aceptado**: es la red de seguridad de un reintento que sí había llegado.
 */
import { msDeFechaYape } from './yape.ts'

// ─── Parámetros ─────────────────────────────────────────────────────────────

/**
 * Días calendario con los que se mide el plazo.
 *
 * ⚠️ **Un solo número para todo lo que va a SUNAT** (decisión del usuario, 24/09/2026): las
 * **facturas** vencen a los **3** días calendario (RS 000003-2023/SUNAT) y las boletas a los 7; se
 * usa **el más estricto** para que nada quede al filo, y es **configurable** porque el negocio puede
 * querer otro margen. El plazo real de cada tipo de documento lo sigue fijando la norma: esto es el
 * margen con el que el app **avisa y decide**, no una reinterpretación de la ley.
 */
export const DIAS_VENCIMIENTO_POR_DEFECTO = 3

/** Cada cuánto corre el barrido mientras hay una pantalla abierta. */
export const INTERVALO_AUTO_MINUTOS_POR_DEFECTO = 10

/** Cuántos comprobantes se mandan por pasada (una ráfaga larga contra el backend local se evita). */
export const MAX_POR_PASADA_POR_DEFECTO = 5

/**
 * Minutos tras los cuales un `enviando` se considera **colgado**.
 *
 * Lo escribe la pestaña que manda, pero esa pestaña **puede cerrarse a mitad del envío** y entonces
 * el documento se quedaría en `enviando` para siempre (nadie lo reintentaría nunca). Pasado este
 * tiempo se vuelve a intentar. Un envío duplicado **no es grave**: SUNAT lo contesta con **1033**
 * («ya fue registrado») y el envío lo marca **aceptado**.
 */
export const MINUTOS_ENVIO_COLGADO = 5

/** Minutos mínimos entre dos intentos automáticos del **mismo** documento (freno del reintento). */
export const MINUTOS_ENTRE_REINTENTOS = 15

/** Tipos de comprobante que se declaran a SUNAT (los que llevan serie y correlativo propios). */
export const TIPOS_COMPROBANTE_SUNAT = ['BOLETA', 'FACTURA'] as const

/** Notas de crédito/débito: van a SUNAT **después** del comprobante que modifican. */
export const TIPOS_NOTA_SUNAT = ['NC', 'ND'] as const

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** El bloque `sunat` del documento (`services/sunat.ts` lo escribe; acá se lee). */
export type BloqueSunat = {
  estado?: string
  serie?: string
  numero?: number | null
  puntoEmision?: string
  ultimoEnvio?: unknown
  /** Respuesta de SUNAT cuando rechazó (`cdr_desc`): es el dato que dice **qué** hay que corregir. */
  cdrDesc?: string | null
  /** El motivo por el que el último intento **no pudo** declararlo (API caída, timeout, dato inválido). */
  error?: string | null
  /** Marca de una NV que ya entró a una boleta consolidada (una NV no se manda sola). */
  consolidado?: unknown
  /** Quién lo tomó y desde cuándo (reclamo de `services/sunat.ts`). */
  enviandoPor?: string
  enviandoEn?: unknown
  intentos?: number
}

/**
 * Un documento tal como lo necesita el barrido.
 * ⚠️ El total y el cliente viven **dentro de `venta`** (así los escribe `registrarVenta`).
 */
export type DocumentoSunat = {
  id: string
  tipoDoc?: string
  serieNumero?: string
  /** Estado del **documento** (`pagado` / `pendiente` / `anulada` / `cancelado`), no el de SUNAT. */
  estado?: string
  fecha?: unknown
  numero?: number | null
  serie?: string
  sunat?: BloqueSunat | null
  venta?: {
    total?: number
    importe_total?: number
    cliente_nombre?: string
    /** A qué comprobante modifica una NC/ND (`B001-000042`): su original se manda primero. */
    documentoReferencia?: string
    docReferencia?: string
  }
}

/** El estado del envío, ya interpretado (uno solo, para que nadie lo relea a mano). */
export type EstadoEnvioSunat = 'no-aplica' | 'sin-enviar' | 'enviando' | 'aceptado' | 'rechazado' | 'error'

/** Por qué **no** se manda solo. `null` = se puede mandar. */
export type MotivoNoEnviarSunat =
  | 'no-aplica'
  | 'anulada'
  | 'aceptado'
  | 'rechazado'
  | 'sin-correlativo'
  | 'vencido'
  | 'en-envio'
  | 'reintento-reciente'

export type OpcionesSunat = {
  /** «Ahora» en ms. Se pasa explícito para poder testear. */
  ahora?: number
  /** Días de plazo (ver `DIAS_VENCIMIENTO_POR_DEFECTO`). */
  dias?: number
  /** Minutos de un `enviando` colgado (ver `MINUTOS_ENVIO_COLGADO`). */
  minColgado?: number
  /** Minutos entre reintentos del mismo documento (ver `MINUTOS_ENTRE_REINTENTOS`). */
  minReintento?: number
}

const DIA_MS = 86400000
const MINUTO_MS = 60000

// ─── Configuración del negocio ──────────────────────────────────────────────

/** Lo que el app necesita de la configuración (todo opcional: una config vieja no rompe nada). */
export type ConfigSunatAuto = {
  /** Interruptor del envío automático. Ausente = **activo** (misma convención que `alertaStockBajo`). */
  sunatAutoEnvio?: boolean
  /** Días de plazo. Ausente o `<= 0` = `DIAS_VENCIMIENTO_POR_DEFECTO`. */
  sunatAutoDiasVencimiento?: number
  /** Minutos entre pasadas. Ausente o `<= 0` = `INTERVALO_AUTO_MINUTOS_POR_DEFECTO`. */
  sunatAutoIntervaloMinutos?: number
  /** Comprobantes por pasada. Ausente o `<= 0` = `MAX_POR_PASADA_POR_DEFECTO`. */
  sunatAutoMaxPorPasada?: number
}

/**
 * ¿El envío automático está activo?
 *
 * ⚠️ **Apagarlo NO rompe el botón manual**: el comprobante se sigue mandando a mano desde
 * `Reportes → Registro SUNAT` exactamente como hasta hoy. Lo único que cambia es que nadie lo manda
 * por atrás.
 */
export function autoEnvioSunatActivo(config?: ConfigSunatAuto | null): boolean {
  return config?.sunatAutoEnvio !== false
}

/**
 * Un número de la config, con el valor por defecto cuando **falta** o no es utilizable.
 * ⚠️ Acá `0` (y lo negativo) cae al valor por defecto —**no** significa «apagado»—: una pasada cada
 * 0 minutos o un plazo de 0 días no son una decisión del negocio, son un campo mal cargado.
 */
function numPositivo(valor: unknown, porDefecto: number): number {
  const n = Number(valor)
  return valor == null || valor === '' || !Number.isFinite(n) || n <= 0 ? porDefecto : n
}

export function diasVencimientoSunat(config?: ConfigSunatAuto | null): number {
  return numPositivo(config?.sunatAutoDiasVencimiento, DIAS_VENCIMIENTO_POR_DEFECTO)
}

export function intervaloAutoSunatMs(config?: ConfigSunatAuto | null): number {
  return numPositivo(config?.sunatAutoIntervaloMinutos, INTERVALO_AUTO_MINUTOS_POR_DEFECTO) * MINUTO_MS
}

export function maxPorPasadaSunat(config?: ConfigSunatAuto | null): number {
  return Math.floor(numPositivo(config?.sunatAutoMaxPorPasada, MAX_POR_PASADA_POR_DEFECTO))
}

// ─── Qué documento es y en qué estado está ──────────────────────────────────

/** ¿Es un tipo que se declara a SUNAT? (`BOLETA`/`FACTURA`/`NC`/`ND`). */
export function esEnviableASunat(doc: DocumentoSunat): boolean {
  const tipo = String(doc.tipoDoc ?? '')
  return (TIPOS_COMPROBANTE_SUNAT as readonly string[]).includes(tipo) || (TIPOS_NOTA_SUNAT as readonly string[]).includes(tipo)
}

/** ¿Es una nota de crédito/débito? (las notas se mandan **después** de su comprobante). */
export function esNotaSunat(doc: DocumentoSunat): boolean {
  return (TIPOS_NOTA_SUNAT as readonly string[]).includes(String(doc.tipoDoc ?? ''))
}

/** El estado del envío, ya interpretado. */
export function estadoEnvioSunat(doc: DocumentoSunat): EstadoEnvioSunat {
  if (!esEnviableASunat(doc)) return 'no-aplica'
  const estado = String(doc.sunat?.estado ?? '')
  if (estado === 'aceptado') return 'aceptado'
  if (estado === 'rechazado') return 'rechazado'
  if (estado === 'enviando') return 'enviando'
  if (estado === 'error') return 'error'
  // ⚠️ **Sin bloque `sunat` = pendiente**, no «desconocido»: es el mismo criterio que usa la pantalla
  // (`Reportes.tsx` le da el botón Enviar a los documentos sin estado) y el que corresponde a un
  // comprobante emitido que todavía no se declaró. Lo que **no** se hace es inventarle un estado.
  return 'sin-enviar'
}

/** La fecha de emisión en ms (`fecha`, con `venta.fecha` de respaldo). `0` si no se puede leer. */
export function emisionSunatMs(doc: DocumentoSunat): number {
  return msDeFechaYape(doc.fecha)
}

/**
 * Cuándo vence: **el día de emisión + `dias`**, a las 23:59:59.999 locales.
 * El reloj es el del negocio (día local), no UTC: un comprobante emitido a las 22:00 vence por su
 * **día local**, no tres días después de esa hora.
 */
export function venceSunatMs(doc: DocumentoSunat, dias = DIAS_VENCIMIENTO_POR_DEFECTO): number {
  const emision = emisionSunatMs(doc)
  if (!emision) return 0
  const d = new Date(emision)
  d.setDate(d.getDate() + dias)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/**
 * Días que le quedan: `0` = **vence hoy**, `1` = mañana, negativo = **ya venció** (cuántos días
 * pasaron). `null` = no se le puede leer la fecha de emisión.
 */
export function diasRestantesSunat(
  doc: DocumentoSunat,
  ahora: number = Date.now(),
  dias = DIAS_VENCIMIENTO_POR_DEFECTO,
): number | null {
  const vence = venceSunatMs(doc, dias)
  if (!vence) return null
  return Math.floor((vence - ahora) / DIA_MS)
}

/** Cuánta urgencia tiene: `vencido` < `critico` (hoy/mañana) < `aviso` < `ok`. */
export type UrgenciaVencimientoSunat = 'vencido' | 'critico' | 'aviso' | 'ok'

export function urgenciaVencimientoSunat(
  doc: DocumentoSunat,
  ahora: number = Date.now(),
  dias = DIAS_VENCIMIENTO_POR_DEFECTO,
): UrgenciaVencimientoSunat {
  const restantes = diasRestantesSunat(doc, ahora, dias)
  if (restantes === null) return 'aviso' // sin fecha: no se puede afirmar que esté en plazo
  if (restantes < 0) return 'vencido'
  if (restantes <= 1) return 'critico'
  return 'aviso'
}

/** «vence hoy», «venció hace 2 días»… Una sola frase, para el correo de nada y para las alertas. */
export function textoVencimientoSunat(
  doc: DocumentoSunat,
  ahora: number = Date.now(),
  dias = DIAS_VENCIMIENTO_POR_DEFECTO,
): string {
  const restantes = diasRestantesSunat(doc, ahora, dias)
  if (restantes === null) return 'sin fecha de emisión'
  if (restantes < 0) return restantes === -1 ? 'venció ayer' : `venció hace ${-restantes} días`
  if (restantes === 0) return 'vence hoy'
  if (restantes === 1) return 'vence mañana'
  return `vence en ${restantes} días`
}

// ─── La decisión ────────────────────────────────────────────────────────────

/** Los minutos pasados desde una marca de tiempo (0 si no se puede leer). */
function minutosDesde(valor: unknown, ahora: number): number {
  const ms = msDeFechaYape(valor)
  if (!ms) return Number.POSITIVE_INFINITY // sin marca: no hay nada que respetar
  return Math.max(0, (ahora - ms) / MINUTO_MS)
}

/**
 * **Por qué este documento NO se manda solo** (o `null` si sí se manda).
 *
 * 🔑 Es la regla que usan el barrido, el reclamo transaccional y las alertas: si uno de los tres
 * decidiera por su cuenta, el botón y el aviso podrían contradecirse.
 */
export function motivoNoEnviarSunat(
  doc: DocumentoSunat,
  opciones: OpcionesSunat = {},
): MotivoNoEnviarSunat | null {
  const ahora = opciones.ahora ?? Date.now()
  const dias = opciones.dias ?? DIAS_VENCIMIENTO_POR_DEFECTO
  const minColgado = opciones.minColgado ?? MINUTOS_ENVIO_COLGADO
  const minReintento = opciones.minReintento ?? MINUTOS_ENTRE_REINTENTOS

  if (!esEnviableASunat(doc)) return 'no-aplica'
  if (String(doc.estado ?? '') === 'anulada' || String(doc.estado ?? '') === 'cancelado') return 'anulada'

  const estado = estadoEnvioSunat(doc)
  if (estado === 'aceptado') return 'aceptado'
  if (estado === 'rechazado') return 'rechazado'

  // ⚠️ **Sin correlativo SUNAT no hay nada que mandar**: el envío fallaría con *«El comprobante no
  // tiene correlativo SUNAT asignado»*. Los comprobantes lo tienen desde que se emiten; esto cubre un
  // documento a medio escribir (o uno viejo de antes de que existiera el bloque).
  const numero = doc.sunat?.numero ?? doc.numero ?? null
  if (numero == null || Number(numero) <= 0) return 'sin-correlativo'

  // Un `enviando` lo tomó otra pestaña o este mismo equipo y quedó colgado por un cierre de pestaña.
  if (estado === 'enviando') {
    const desde = doc.sunat?.enviandoEn ?? doc.sunat?.ultimoEnvio
    if (minutosDesde(desde, ahora) < minColgado) return 'en-envio'
  }

  // Un `error` se reintenta, pero no en cada pasada: un comprobante roto (payload inválido) no puede
  // golpear la API cada 10 minutos.
  if (estado === 'error' && minutosDesde(doc.sunat?.ultimoEnvio, ahora) < minReintento) return 'reintento-reciente'

  // ⚠️ **El plazo**: pasado el vencimiento el envío automático se detiene (mandar una factura vencida
  // no le devuelve la calidad de factura electrónica). El documento **no se pierde**: sigue en la
  // lista, se avisa como vencido y **se puede mandar a mano** como siempre.
  const restantes = diasRestantesSunat(doc, ahora, dias)
  if (restantes !== null && restantes < 0) return 'vencido'

  return null
}

/** ¿Este documento se puede mandar **solo** ahora? (Lo mismo que `motivoNoEnviarSunat() === null`.) */
export function puedeEnviarseSunat(doc: DocumentoSunat, opciones: OpcionesSunat = {}): boolean {
  return motivoNoEnviarSunat(doc, opciones) === null
}

/**
 * ¿Necesita que alguien lo mire? (pendiente, con error o un `enviando` colgado).
 * ⚠️ **Lo anulado/cancelado y lo que no va a SUNAT quedan fuera**: ya no hay nada que hacer con eso,
 * y meterlos en el aviso ensuciaría el único número que importa.
 */
export function esperaEnvioSunat(doc: DocumentoSunat, opciones: OpcionesSunat = {}): boolean {
  if (!esEnviableASunat(doc)) return false
  const estadoDoc = String(doc.estado ?? '')
  if (estadoDoc === 'anulada' || estadoDoc === 'cancelado') return false
  const estado = estadoEnvioSunat(doc)
  if (estado === 'sin-enviar' || estado === 'error') return true
  if (estado !== 'enviando') return false
  const ahora = opciones.ahora ?? Date.now()
  const minColgado = opciones.minColgado ?? MINUTOS_ENVIO_COLGADO
  const desde = doc.sunat?.enviandoEn ?? doc.sunat?.ultimoEnvio
  return minutosDesde(desde, ahora) >= minColgado
}

/**
 * El bloque `sunat` que se escribe al **tomar** un documento (reclamo transaccional en
 * `services/sunat.ts`).
 *
 * 🔑 **Para qué**: con dos pestañas abiertas (o dos equipos), las dos verían el mismo comprobante
 * `pendiente` y **las dos lo mandarían**. El reclamo lo marca `enviando` **dentro de una
 * transacción**, así la segunda lo ve tomado y no lo manda. Si la que lo tomó muere, el reclamo
 * caduca solo (`MINUTOS_ENVIO_COLGADO`) — es el mismo criterio que la reserva de un aviso de Yape.
 * ⚠️ Un envío duplicado igual no rompe nada: SUNAT contesta **1033** y el envío lo marca aceptado.
 */
export function camposDeReclamoSunat(
  doc: DocumentoSunat,
  opciones: { dispositivo?: string; ahora?: number } = {},
): BloqueSunat {
  const ahora = opciones.ahora ?? Date.now()
  return {
    ...(doc.sunat ?? {}),
    estado: 'enviando',
    enviandoPor: String(opciones.dispositivo ?? '').slice(0, 60),
    enviandoEn: new Date(ahora).toISOString(),
    // Cuántos intentos automáticos lleva: sirve para diagnosticar sin abrir cada documento.
    intentos: (Number(doc.sunat?.intentos) || 0) + 1,
  }
}

// ─── Orden y selección ──────────────────────────────────────────────────────

/** Peso de envío: **el comprobante primero, la nota después** (una nota sin su original no se acepta). */
function pesoEnvioSunat(doc: DocumentoSunat): number {
  return esNotaSunat(doc) ? 1 : 0
}

/** El día de emisión (para desempatar dos documentos con el mismo vencimiento). */
function emisionOrden(doc: DocumentoSunat): number {
  return emisionSunatMs(doc) || Number.MAX_SAFE_INTEGER
}

/**
 * Los documentos **en el orden en que se tienen que mandar**: comprobantes antes que notas, y dentro
 * de cada grupo el que vence primero. Con el mismo vencimiento, el más viejo primero, y el `id`
 * cierra el orden para que dos barridos no elijan cosas distintas (el orden tiene que ser estable).
 */
export function ordenarParaEnvioSunat(
  docs: readonly DocumentoSunat[],
  opciones: OpcionesSunat = {},
): DocumentoSunat[] {
  const dias = opciones.dias ?? DIAS_VENCIMIENTO_POR_DEFECTO
  return [...docs].sort((a, b) => {
    const peso = pesoEnvioSunat(a) - pesoEnvioSunat(b)
    if (peso !== 0) return peso
    const venceA = venceSunatMs(a, dias) || Number.MAX_SAFE_INTEGER
    const venceB = venceSunatMs(b, dias) || Number.MAX_SAFE_INTEGER
    if (venceA !== venceB) return venceA - venceB
    const emision = emisionOrden(a) - emisionOrden(b)
    if (emision !== 0) return emision
    return String(a.id).localeCompare(String(b.id))
  })
}

/**
 * Los que **esperan que alguien los mire** (pendientes, con error o colgados), **el más urgente
 * primero** (el que vence antes, y el vencido delante de todo).
 * ⚠️ No es lo mismo que «lo que se manda»: un vencido aparece acá —hay que decidir algo con él— y
 * **no** entra en `elegirParaEnviarSunat()`.
 */
export function pendientesDeEnvioSunat(
  docs: readonly DocumentoSunat[],
  opciones: OpcionesSunat = {},
): DocumentoSunat[] {
  return ordenarParaEnvioSunat(
    docs.filter((d) => esperaEnvioSunat(d, opciones)),
    opciones,
  )
}

/**
 * **Lo que se manda en esta pasada**: los que se pueden mandar solos, en orden, hasta el tope.
 * `max = 0` (o negativo) significa **sin tope**: se manda todo lo que hay.
 */
export function elegirParaEnviarSunat(
  docs: readonly DocumentoSunat[],
  opciones: OpcionesSunat & { max?: number } = {},
): DocumentoSunat[] {
  const listos = pendientesDeEnvioSunat(docs, opciones).filter((d) => puedeEnviarseSunat(d, opciones))
  const max = opciones.max == null ? MAX_POR_PASADA_POR_DEFECTO : Math.floor(opciones.max)
  return max > 0 ? listos.slice(0, max) : listos
}

/** Etiqueta corta de un documento para los avisos (`B001-000042` o su id). */
export function etiquetaSunat(doc: DocumentoSunat): string {
  const serie = String(doc.sunat?.serie || doc.serie || '').trim()
  const numero = doc.sunat?.numero ?? doc.numero ?? null
  if (serie && numero != null) return `${serie}-${String(numero).padStart(6, '0')}`
  return String(doc.serieNumero || doc.id || 'documento')
}
