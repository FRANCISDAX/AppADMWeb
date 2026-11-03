/**
 * **«¿Está todo funcionando?»** — la regla del **estado del sistema** (02/11/2026).
 *
 * 🔑 **Por qué existe**: el negocio depende de **cuatro** cosas que viven fuera de la pantalla donde se
 * trabaja y cada una fallaba **en un lugar distinto**: la **caja web** (¿se están guardando los
 * movimientos?), la **API de SUNAT** (¿se pueden emitir comprobantes?), el **puente de Yape** (¿están
 * llegando los avisos del celular?) y el **respaldo** (¿hay copia?). Hasta ahora eso se miraba en tres
 * pantallas —o no se miraba— y el problema se descubría por el cliente o al cerrar el turno.
 *
 * ⚠️ **Esto INFORMA, no bloquea**: ninguna de estas señales impide cobrar, emitir ni cerrar. Y una
 * señal sin datos **no es una caída**: `sin-datos` significa *«el sistema no sabe»* (un negocio nuevo
 * todavía no tiene respaldo, o el celular nunca latió) y el arreglo es distinto de *«está roto»*.
 *
 * 🔑 **Una sola forma para las cuatro tarjetas**: cada servicio se resume en el mismo `Servicio`
 * (`nivel` + `titulo` + `detalle` + `accion`) para que la pantalla **solo dibuje** y el resumen diga
 * una sola frase. Las reglas del puente y del respaldo **no se reescriben acá**: se delegan en
 * `estadoDelPuente()` y `estadoDelRespaldo()`, que ya las tienen y ya las usan sus pantallas.
 *
 * ⚠️ **La prueba de la API no se guarda** (decisión del usuario): es una foto del momento, se toma al
 * abrir la pantalla y no queda ni en Firestore ni en el navegador.
 */
import { estadoDelPuente, recomendacionDelPuente, textoDelPuente, textoUltimoAviso, type LatidoPuenteYape } from './puente.ts'
import { estadoDelRespaldo, hace, type EstadoRespaldoDatos } from './respaldo-estado.ts'

/** Los mismos cinco estados para las cuatro tarjetas (`probando` = todavía no hay respuesta). */
export type NivelServicio = 'ok' | 'atencion' | 'critico' | 'sin-datos' | 'probando'

export type IdServicio = 'web' | 'api' | 'puente' | 'respaldo'

export type Servicio = {
  id: IdServicio
  /** El nombre corto de la tarjeta. */
  nombre: string
  nivel: NivelServicio
  /** Qué está pasando, en una línea. */
  titulo: string
  /** El dato que lo respalda (fecha, milisegundos, último aviso). */
  detalle: string
  /** Qué hacer si no está bien. Vacío cuando está bien. */
  accion: string
}

/** Pasadas estas horas sin ningún movimiento, la caja **parece** quieta (un fin de semana largo es normal). */
export const HORAS_WEB_ATENCION = 72
/** Pasada una semana sin UN movimiento, algo no está guardando: eso sí hay que mirarlo. */
export const HORAS_WEB_CRITICO = 24 * 7

/**
 * Una API que contesta pasado esto ya es «lenta».
 *
 * ⚠️ **Medido el 02/11/2026** contra la API real (`GET /v1/dni`): **3,6 s en frío** (la Lambda se
 * despierta) y **0,65-0,75 s en caliente**. El umbral está por encima del arranque en frío a propósito:
 * si avisara a los 3 s, la primera visita del día teñiría de ámbar una API que está perfecta.
 */
export const LATENCIA_LENTA_MS = 6000
/** Y pasado esto se corta: `fetch` sin límite deja la tarjeta colgada para siempre. */
export const PING_TIMEOUT_MS = 15000

/**
 * La ruta con la que se prueba que la API está viva.
 *
 * 🔑 **`GET /v1/dni` SIN el número**: la API responde **422** (le falta el parámetro `numero`) sin
 * consultar a nadie — no toca SUNAT, no gasta la consulta de DNI/RUC y es un `GET` simple, así que el
 * navegador no manda un preflight. ⚠️ **`GET /` no sirve**: API Gateway contesta *403 Missing
 * Authentication Token* (esa ruta no existe) y esa respuesta **no lleva** las cabeceras de CORS.
 */
export const PING_RUTA = '/v1/dni'
/** El código que se considera «la API está viva y validando». */
export const PING_CODIGO_ESPERADO = 422

/** El último movimiento registrado (`tblDocumentos`), tal como lo trae `services/estado-sistema.ts`. */
export type UltimoMovimiento = { fecha: string; etiqueta: string }

/** Lo que devolvió la prueba de vida de la API. `codigo: null` = ni siquiera hubo respuesta. */
export type PingApi = {
  ok: boolean
  latenciaMs: number
  codigo: number | null
  error: string | null
  /** Cuándo se probó (ms), para decir «probado hace…». */
  cuando: number
}

const NIVELES: Record<NivelServicio, number> = { ok: 0, probando: 1, 'sin-datos': 2, atencion: 3, critico: 4 }

/** El nombre del documento para el detalle (`Boleta B001-00000103`). */
const NOMBRES_DOC: Record<string, string> = {
  BOLETA: 'Boleta',
  FACTURA: 'Factura',
  NV: 'Nota de venta',
  NC: 'Nota de crédito',
  ND: 'Nota de débito',
  RETIRO: 'Retiro sin cobro',
  PENDIENTE: 'Pedido',
}

/** `Boleta B001-00000103` — con el tipo que la persona reconoce, no el código interno. */
export function etiquetaDeDocumento(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return ''
  const tipo = String(doc.tipoDoc ?? doc.tipo ?? '').trim().toUpperCase()
  const nombre = NOMBRES_DOC[tipo] ?? tipo
  const serie = String(doc.serie ?? '').trim()
  const numero = Number(doc.numero) || 0
  const correlativo = numero > 0 ? `${serie ? `${serie}-` : ''}${String(numero).padStart(6, '0')}` : ''
  const total = Number(doc.total)
  const plata = Number.isFinite(total) ? ` · S/ ${total.toFixed(2)}` : ''
  return [nombre, correlativo].filter(Boolean).join(' ') + plata
}

/** Las horas (con un decimal) entre dos instantes; nunca negativo (un reloj adelantado no da «hace −3 h»). */
export function horasEntre(desde: number, ahora: number = Date.now()): number {
  if (!Number.isFinite(desde) || desde <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.round(((ahora - desde) / 3600000) * 10) / 10)
}

/**
 * **La caja web: ¿hace cuánto que no registra nada?**
 *
 * ⚠️ Un negocio cerrado el domingo **no está roto**: por eso el umbral de atención son **3 días** y el
 * crítico **una semana**. Lo que delata un problema es que alguien esté vendiendo y no quede rastro.
 */
export function servicioWeb(ultimo: UltimoMovimiento | null | undefined, ahora: number = Date.now()): Servicio {
  const base = { id: 'web' as const, nombre: 'Caja (app web)' }
  const fecha = String(ultimo?.fecha ?? '').trim()
  const t = fecha ? new Date(fecha).getTime() : Number.NaN
  if (!ultimo || !fecha || !Number.isFinite(t)) {
    return {
      ...base,
      nivel: 'sin-datos',
      titulo: 'Todavía no hay ningún movimiento registrado',
      detalle: 'El sistema no encontró ventas, notas ni pedidos en el historial.',
      accion: 'Si el negocio ya vendió, mira la pestaña Errores: puede que la venta no se haya guardado.',
    }
  }

  const h = horasEntre(t, ahora)
  const cuando = hace(h)
  const que = ultimo.etiqueta ? `Último: ${ultimo.etiqueta} (${cuando}).` : `Último movimiento ${cuando}.`

  if (h >= HORAS_WEB_CRITICO) {
    return {
      ...base,
      nivel: 'critico',
      titulo: `La caja no registra movimientos ${cuando}`,
      detalle: que,
      accion: 'Ni una venta en una semana es raro: revisa que estén cobrando en este app y mira la pestaña Errores.',
    }
  }
  if (h >= HORAS_WEB_ATENCION) {
    return {
      ...base,
      nivel: 'atencion',
      titulo: `Sin movimientos ${cuando}`,
      detalle: que,
      accion: 'Si el negocio estuvo cerrado es normal; si abrieron y vendieron, no se está guardando nada.',
    }
  }
  return { ...base, nivel: 'ok', titulo: `La caja está registrando (${cuando})`, detalle: que, accion: '' }
}

/**
 * **La API de SUNAT: ¿contesta?** — a partir de la prueba en vivo (`probarApiSunat`).
 *
 * 🔑 Se separa «no contesta» (crítico: no se puede emitir) de «contesta raro» (atención: contesta pero
 * no con lo esperado, puede ser la ruta o el despliegue) y de «contesta lento».
 */
export function servicioApi(ping: PingApi | null | undefined, ahora: number = Date.now()): Servicio {
  const base = { id: 'api' as const, nombre: 'API SUNAT' }
  if (!ping) {
    return {
      ...base,
      nivel: 'probando',
      titulo: 'Probando la API…',
      detalle: 'La prueba se hace al abrir esta pantalla y no se guarda.',
      accion: '',
    }
  }
  const probado = hace(horasEntre(ping.cuando, ahora))
  const ms = Math.round(Number(ping.latenciaMs) || 0)
  if (ping.error || ping.codigo === null || ping.codigo === undefined) {
    return {
      ...base,
      nivel: 'critico',
      titulo: 'La API SUNAT no responde',
      detalle: `${ping.error ?? 'No hubo respuesta'}. Probado ${probado}.`,
      accion: 'Sin la API no se puede emitir: revisa la URL en Configuración → SUNAT y el internet de la caja.',
    }
  }
  if (ping.codigo !== PING_CODIGO_ESPERADO) {
    return {
      ...base,
      nivel: 'atencion',
      titulo: `La API SUNAT contestó ${ping.codigo}`,
      detalle: `Se esperaba ${PING_CODIGO_ESPERADO} en ${PING_RUTA}. Respondió en ${ms} ms (probado ${probado}).`,
      accion: 'Contesta, pero no como siempre: si al emitir falla, revisa que la API desplegada sea la última.',
    }
  }
  if (ms >= LATENCIA_LENTA_MS) {
    return {
      ...base,
      nivel: 'atencion',
      titulo: 'La API SUNAT contesta lento',
      detalle: `${ms} ms (lo normal es menos de ${LATENCIA_LENTA_MS}) · probado ${probado}.`,
      accion: 'Los comprobantes van a demorar en salir. Si sigue así, mira el internet del local.',
    }
  }
  return { ...base, nivel: 'ok', titulo: 'La API SUNAT responde', detalle: `${ms} ms · probado ${probado}.`, accion: '' }
}

/**
 * **El puente de Yape**: se delega en `lib/puente.ts` (la misma regla que el PDV).
 *
 * ⚠️ El puente dice **`activo`** y **`caido`** donde el panel dice `ok` y `critico`: son el mismo
 * escalón y los nombres del puente **no se cambian acá** (los usan el PDV y Configuración → Yape).
 */
export function servicioPuente(latido: LatidoPuenteYape | null | undefined, ahora: number = Date.now()): Servicio {
  const estado = estadoDelPuente(latido, ahora)
  const nivel: NivelServicio =
    estado === 'caido' ? 'critico' : estado === 'activo' ? 'ok' : estado === 'demorado' ? 'atencion' : 'sin-datos'
  return {
    id: 'puente',
    nombre: 'Puente Yape',
    nivel,
    titulo: textoDelPuente(latido, ahora),
    detalle: textoUltimoAviso(latido, ahora),
    accion: nivel === 'ok' ? '' : recomendacionDelPuente(latido, ahora),
  }
}

/** **El respaldo**: se delega en `lib/respaldo-estado.ts` (la misma regla que Mis Datos). */
export function servicioRespaldo(datos: EstadoRespaldoDatos, ahora: Date = new Date()): Servicio {
  const estado = estadoDelRespaldo(datos, ahora)
  return {
    id: 'respaldo',
    nombre: 'Respaldo',
    nivel: estado.nivel,
    titulo: estado.titulo,
    detalle: estado.detalle,
    accion: estado.alerta
      ? 'Sin copia, un borrado o un error no se puede deshacer: revisa que la PC esté prendida a las 23:30.'
      : '',
  }
}

export type ResumenSistema = {
  servicios: Servicio[]
  /** Cuántos están `ok`. */
  bien: number
  total: number
  /** Cuántos piden atención (ni `ok` ni `probando`). */
  pendientes: number
  /** El peor nivel: define el color y el ícono del encabezado. */
  peor: NivelServicio
  /** La frase del encabezado, ya escrita. */
  frase: string
}

/**
 * **Las cuatro tarjetas y la frase de arriba.**
 *
 * ⚠️ `probando` **no cuenta como problema**: una tarjeta que todavía no contestó no puede teñir de rojo
 * la pantalla ni entrar en «para revisar» (`sin-datos` **sí** se cuenta: es «no hay señal de vida», y
 * eso hay que verlo). Si **nada** contestó todavía, el encabezado lo dice en vez de mentir con un
 * «todo bien».
 */
export function resumenSistema(servicios: Servicio[]): ResumenSistema {
  const total = servicios.length
  const bien = servicios.filter((s) => s.nivel === 'ok').length
  const resueltos = servicios.filter((s) => s.nivel !== 'probando')
  const sinProbar = total - resueltos.length
  const pendientes = resueltos.filter((s) => s.nivel !== 'ok').length
  const caidos = servicios.filter((s) => s.nivel === 'critico').length
  const peor = resueltos.reduce<NivelServicio>(
    (grave, s) => (NIVELES[s.nivel] > NIVELES[grave] ? s.nivel : grave),
    'ok',
  )

  const frase =
    resueltos.length === 0
      ? 'Probando los servicios…'
      : peor === 'critico'
        ? `Hay ${caidos} servicio(s) caído(s)`
        : peor === 'ok'
          ? sinProbar > 0
            ? `${bien} de ${total} responden (probando el resto)`
            : `Los ${total} servicios responden`
          : `${pendientes} de ${total} para revisar`

  const nivelEncabezado: NivelServicio = resueltos.length === 0 ? 'probando' : peor
  return { servicios, bien, total, pendientes, peor: nivelEncabezado, frase }
}

/** Los colores, en un solo lugar (los usa la tarjeta del panel). */
export const COLORES_SERVICIO: Record<NivelServicio, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  atencion: 'text-amber-600 dark:text-amber-400',
  critico: 'text-destructive',
  'sin-datos': 'text-muted-foreground',
  probando: 'text-muted-foreground',
}
