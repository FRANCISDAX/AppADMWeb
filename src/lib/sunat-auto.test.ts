/**
 * Envío automático a SUNAT (`lib/sunat-auto.ts`): **qué se manda solo, qué no y por qué**.
 *
 * 🔑 **Lo que estos tests protegen** (24/09/2026), que es exactamente lo que puede hacer daño en
 * producción, porque el barrido corre **sin nadie mirando**:
 *
 * - **Nunca se manda dos veces lo aceptado**, ni se insiste con lo que SUNAT **rechazó** (eso pide
 *   una persona: corregir y reemitir).
 * - **Una nota no se adelanta a su comprobante**: primero el original, después la NC/ND.
 * - **Una nota de venta y un pedido no van a SUNAT** (una NV se declara consolidada en una boleta).
 * - **Un `enviando` de otra pestaña no se pisa**, pero un `enviando` colgado (la pestaña se cerró a
 *   mitad) **sí se recupera**: si no, ese comprobante no se mandaría nunca.
 * - **El plazo**: se mide en **día local** y pasado el vencimiento el envío automático **se frena**
 *   (mandar una factura vencida no le devuelve la calidad de factura electrónica) — el botón manual
 *   sigue disponible, eso lo prueba `motivoNoEnviarSunat` devolviendo `vencido` y no el envío.
 * - **`0` no es «apagado»** en los números de esta config: un plazo de 0 días o una pasada cada 0
 *   minutos son campos mal cargados y vuelven al valor por defecto. El interruptor es otro campo.
 */
import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import {
  DIAS_VENCIMIENTO_POR_DEFECTO,
  INTERVALO_AUTO_MINUTOS_POR_DEFECTO,
  MAX_POR_PASADA_POR_DEFECTO,
  MINUTOS_ENVIO_COLGADO,
  MINUTOS_ENTRE_REINTENTOS,
  autoEnvioSunatActivo,
  camposDeReclamoSunat,
  diasRestantesSunat,
  diasVencimientoSunat,
  elegirParaEnviarSunat,
  esEnviableASunat,
  esperaEnvioSunat,
  estadoEnvioSunat,
  etiquetaSunat,
  intervaloAutoSunatMs,
  maxPorPasadaSunat,
  motivoNoEnviarSunat,
  ordenarParaEnvioSunat,
  pendientesDeEnvioSunat,
  puedeEnviarseSunat,
  textoVencimientoSunat,
  urgenciaVencimientoSunat,
  venceSunatMs,
  type DocumentoSunat,
} from './sunat-auto.ts'

const MIN = 60000

/**
 * ⚠️ «Ahora» y las fechas se arman con **hora local** (`new Date(año, mes, día, …)`): el plazo se
 * mide en días **locales**, así que un ISO en UTC haría que el test dependa de la zona horaria de la
 * máquina que lo corre.
 */
const AHORA = new Date(2026, 8, 24, 22, 10, 0, 0).getTime()

/** Un comprobante emitido a las 22:00 del 24/09/2026 (el caso normal: se vende y queda pendiente). */
function doc(extra: Partial<DocumentoSunat> = {}): DocumentoSunat {
  const base: DocumentoSunat = {
    id: '2026-9_BOLETA-B001-000042',
    tipoDoc: 'BOLETA',
    serieNumero: 'B001-000042',
    estado: 'pagado',
    fecha: new Date(2026, 8, 24, 22, 0, 0, 0).toISOString(),
    numero: 42,
    serie: 'B001',
    sunat: { estado: 'pendiente', serie: 'B001', numero: 42, ultimoEnvio: new Date(2026, 8, 24, 22, 0, 0, 0).toISOString() },
    venta: { total: 25 },
  }
  return { ...base, ...extra, sunat: extra.sunat === undefined ? base.sunat : extra.sunat }
}

describe('qué documento va a SUNAT', () => {
  test('solo los comprobantes y sus notas: una NV y un pedido no van', () => {
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'BOLETA' })), true)
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'FACTURA' })), true)
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'NC' })), true)
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'ND' })), true)
    // ⚠️ La NV se declara **consolidada** en una boleta: mandarla sola sería declarar dos veces.
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'NV' })), false)
    // ⚠️ Un pedido todavía no es un comprobante (no tiene serie ni correlativo propios).
    assert.equal(esEnviableASunat(doc({ tipoDoc: 'PENDIENTE' })), false)
    assert.equal(esEnviableASunat(doc({ tipoDoc: undefined })), false)
  })

  test('el estado del envío se lee de una sola forma (y sin bloque sunat es «sin enviar»)', () => {
    assert.equal(estadoEnvioSunat(doc({ sunat: { estado: 'aceptado' } })), 'aceptado')
    assert.equal(estadoEnvioSunat(doc({ sunat: { estado: 'rechazado' } })), 'rechazado')
    assert.equal(estadoEnvioSunat(doc({ sunat: { estado: 'enviando' } })), 'enviando')
    assert.equal(estadoEnvioSunat(doc({ sunat: { estado: 'error' } })), 'error')
    assert.equal(estadoEnvioSunat(doc({ sunat: { estado: 'pendiente' } })), 'sin-enviar')
    // Un comprobante viejo sin bloque `sunat` es **pendiente** (mismo criterio que la pantalla), no
    // «desconocido»: tiene correlativo y nunca se declaró.
    assert.equal(estadoEnvioSunat(doc({ sunat: null })), 'sin-enviar')
    assert.equal(estadoEnvioSunat(doc({ tipoDoc: 'NV', sunat: null })), 'no-aplica')
  })
})

describe('la decisión de mandarlo solo', () => {
  test('un comprobante pendiente, con correlativo y en plazo, se manda', () => {
    assert.equal(motivoNoEnviarSunat(doc(), { ahora: AHORA }), null)
    assert.equal(puedeEnviarseSunat(doc(), { ahora: AHORA }), true)
  })

  test('NUNCA se manda dos veces lo aceptado', () => {
    const aceptado = doc({ sunat: { estado: 'aceptado', serie: 'B001', numero: 42 } })
    assert.equal(motivoNoEnviarSunat(aceptado, { ahora: AHORA }), 'aceptado')
    assert.equal(puedeEnviarseSunat(aceptado, { ahora: AHORA }), false)
    assert.equal(esperaEnvioSunat(aceptado, { ahora: AHORA }), false)
  })

  test('lo RECHAZADO no se reintenta solo: eso pide una persona', () => {
    // Insistir con el mismo XML que SUNAT ya rechazó no lo va a arreglar, y taparía el problema: el
    // comprobante se corrige y se reemite (o se emite una nota), que es una decisión humana.
    const rechazado = doc({ sunat: { estado: 'rechazado', serie: 'B001', numero: 42, cdrDesc: 'RUC inválido' } })
    assert.equal(motivoNoEnviarSunat(rechazado, { ahora: AHORA }), 'rechazado')
    assert.equal(puedeEnviarseSunat(rechazado, { ahora: AHORA }), false)
  })

  test('un documento anulado no se declara (aunque su bloque sunat quedó «pendiente»)', () => {
    // Al anular se reescribe el documento con `estado: 'anulada'` y el bloque `sunat` viejo queda
    // adentro: sin este control, el barrido declararía algo que el negocio ya dio de baja.
    const anulada = doc({ estado: 'anulada' })
    assert.equal(motivoNoEnviarSunat(anulada, { ahora: AHORA }), 'anulada')
    assert.equal(esperaEnvioSunat(anulada, { ahora: AHORA }), false)
  })

  test('sin correlativo SUNAT no hay nada que mandar', () => {
    assert.equal(motivoNoEnviarSunat(doc({ numero: 0, sunat: { estado: 'pendiente' } }), { ahora: AHORA }), 'sin-correlativo')
    assert.equal(motivoNoEnviarSunat(doc({ numero: null, sunat: { estado: 'pendiente' } }), { ahora: AHORA }), 'sin-correlativo')
  })

  test('un `enviando` de otra pestaña no se pisa, pero uno colgado se recupera', () => {
    // 🔑 Las dos caras del mismo control: sin lo primero, dos pestañas mandan el mismo comprobante;
    // sin lo segundo, una pestaña que se cerró a mitad de envío deja el documento en `enviando`
    // **para siempre** (nadie lo reintenta nunca).
    const reciente = doc({
      sunat: { estado: 'enviando', enviandoEn: new Date(AHORA - 1 * MIN).toISOString(), ultimoEnvio: new Date(AHORA - 1 * MIN).toISOString() },
    })
    assert.equal(motivoNoEnviarSunat(reciente, { ahora: AHORA }), 'en-envio')
    assert.equal(esperaEnvioSunat(reciente, { ahora: AHORA }), false)

    const colgado = doc({
      sunat: {
        estado: 'enviando',
        enviandoEn: new Date(AHORA - (MINUTOS_ENVIO_COLGADO + 1) * MIN).toISOString(),
        ultimoEnvio: new Date(AHORA - (MINUTOS_ENVIO_COLGADO + 1) * MIN).toISOString(),
      },
    })
    assert.equal(motivoNoEnviarSunat(colgado, { ahora: AHORA }), null)
    assert.equal(esperaEnvioSunat(colgado, { ahora: AHORA }), true)
  })

  test('un `enviando` sin marca de tiempo también se recupera (si no, quedaría trabado)', () => {
    const sinMarca = doc({ sunat: { estado: 'enviando' } })
    assert.equal(puedeEnviarseSunat(sinMarca, { ahora: AHORA }), true)
  })

  test('un ERROR se reintenta, pero no en cada pasada', () => {
    // Un corte de red se reintenta solo (el comprobante puede haber quedado sin declarar), pero un
    // payload inválido devolvería error siempre: sin el freno, la API local recibiría el mismo
    // comprobante roto cada 10 minutos.
    const reciente = doc({ sunat: { estado: 'error', ultimoEnvio: new Date(AHORA - 5 * MIN).toISOString() } })
    assert.equal(motivoNoEnviarSunat(reciente, { ahora: AHORA }), 'reintento-reciente')

    const viejo = doc({ sunat: { estado: 'error', ultimoEnvio: new Date(AHORA - (MINUTOS_ENTRE_REINTENTOS + 1) * MIN).toISOString() } })
    assert.equal(motivoNoEnviarSunat(viejo, { ahora: AHORA }), null)
    // Y sin `ultimoEnvio` (un error viejo, de antes de que se guardara) también se reintenta.
    const sinMarca = doc({ sunat: { estado: 'error' } })
    assert.equal(puedeEnviarseSunat(sinMarca, { ahora: AHORA }), true)
  })
})

describe('el plazo (días locales, no horas)', () => {
  test('vence al final del día de emisión + 3 días, en hora local', () => {
    const vence = venceSunatMs(doc())
    const d = new Date(vence)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 8)
    assert.equal(d.getDate(), 27, 'emitido el 24/09 ⇒ vence el 27/09 (3 días calendario)')
    assert.equal(d.getHours(), 23)
    assert.equal(d.getMinutes(), 59)
  })

  test('los días que quedan se cuentan en días, y el mismo día dice «vence hoy»', () => {
    // 24/09 (emisión) → 27/09 = 3 días.
    assert.equal(diasRestantesSunat(doc(), AHORA), 3)
    assert.equal(diasRestantesSunat(doc(), new Date(2026, 8, 26, 9, 0, 0, 0).getTime()), 1)
    assert.equal(diasRestantesSunat(doc(), new Date(2026, 8, 27, 9, 0, 0, 0).getTime()), 0)
    assert.equal(textoVencimientoSunat(doc(), new Date(2026, 8, 27, 9, 0, 0, 0).getTime()), 'vence hoy')
    assert.equal(textoVencimientoSunat(doc(), new Date(2026, 8, 26, 9, 0, 0, 0).getTime()), 'vence mañana')
  })

  test('pasado el vencimiento el envío automático se FRENA (el manual sigue)', () => {
    // 🔑 Esta es la decisión conservadora: mandar una factura vencida no le devuelve la calidad de
    // factura electrónica, así que el app no lo hace solo — avisa y deja que una persona decida.
    const despues = new Date(2026, 8, 28, 0, 30, 0, 0).getTime()
    assert.equal(diasRestantesSunat(doc(), despues), -1)
    assert.equal(motivoNoEnviarSunat(doc(), { ahora: despues }), 'vencido')
    assert.equal(puedeEnviarseSunat(doc(), { ahora: despues }), false)
    // Pero **sigue esperando que alguien lo mire** (la alerta lo tiene que ver).
    assert.equal(esperaEnvioSunat(doc(), { ahora: despues }), true)
    assert.equal(textoVencimientoSunat(doc(), despues), 'venció ayer')
    assert.equal(textoVencimientoSunat(doc(), new Date(2026, 8, 30, 12, 0, 0, 0).getTime()), 'venció hace 3 días')
  })

  test('la urgencia distingue lo vencido, lo que vence hoy/mañana y lo que tiene margen', () => {
    assert.equal(urgenciaVencimientoSunat(doc(), new Date(2026, 8, 28, 1, 0, 0, 0).getTime()), 'vencido')
    assert.equal(urgenciaVencimientoSunat(doc(), new Date(2026, 8, 27, 8, 0, 0, 0).getTime()), 'critico')
    assert.equal(urgenciaVencimientoSunat(doc(), new Date(2026, 8, 26, 8, 0, 0, 0).getTime()), 'critico')
    assert.equal(urgenciaVencimientoSunat(doc(), new Date(2026, 8, 25, 8, 0, 0, 0).getTime()), 'aviso')
  })

  test('una fecha de emisión ilegible no rompe: avisa sin afirmar que está en plazo', () => {
    const sinFecha = doc({ fecha: undefined })
    assert.equal(diasRestantesSunat(sinFecha, AHORA), null)
    assert.equal(urgenciaVencimientoSunat(sinFecha, AHORA), 'aviso')
    assert.equal(textoVencimientoSunat(sinFecha, AHORA), 'sin fecha de emisión')
    // Y el envío no se frena por no poder leer la fecha (el comprobante existe y hay que declararlo).
    assert.equal(puedeEnviarseSunat(sinFecha, { ahora: AHORA }), true)
  })

  test('el plazo es configurable (y `0` NO lo apaga: vuelve al valor por defecto)', () => {
    const de7 = { sunatAutoDiasVencimiento: 7 }
    assert.equal(diasVencimientoSunat(de7), 7)
    assert.equal(diasRestantesSunat(doc(), AHORA, 7), 7)
    // Un plazo de 0 días dejaría todo vencido al instante: es un campo mal cargado, no una decisión.
    assert.equal(diasVencimientoSunat({ sunatAutoDiasVencimiento: 0 }), DIAS_VENCIMIENTO_POR_DEFECTO)
    // Un campo en blanco (lo que deja un input vacío) tampoco puede apagar el plazo.
    assert.equal(diasVencimientoSunat({ sunatAutoDiasVencimiento: '' as unknown as number }), DIAS_VENCIMIENTO_POR_DEFECTO)
    // Config vieja (sin el campo) ⇒ el valor por defecto.
    assert.equal(diasVencimientoSunat({}), DIAS_VENCIMIENTO_POR_DEFECTO)
    assert.equal(diasVencimientoSunat(null), DIAS_VENCIMIENTO_POR_DEFECTO)
  })

  test('el interruptor: ausente = activo; solo `false` lo apaga', () => {
    assert.equal(autoEnvioSunatActivo({}), true)
    assert.equal(autoEnvioSunatActivo(null), true)
    assert.equal(autoEnvioSunatActivo({ sunatAutoEnvio: true }), true)
    assert.equal(autoEnvioSunatActivo({ sunatAutoEnvio: false }), false)
  })

  test('el intervalo y el tope por pasada también tienen valor por defecto', () => {
    assert.equal(intervaloAutoSunatMs({ sunatAutoIntervaloMinutos: 5 }), 5 * MIN)
    assert.equal(intervaloAutoSunatMs({ sunatAutoIntervaloMinutos: 0 }), INTERVALO_AUTO_MINUTOS_POR_DEFECTO * MIN)
    assert.equal(maxPorPasadaSunat({}), MAX_POR_PASADA_POR_DEFECTO)
    assert.equal(maxPorPasadaSunat({ sunatAutoMaxPorPasada: 10 }), 10)
    assert.equal(maxPorPasadaSunat({ sunatAutoMaxPorPasada: -3 }), MAX_POR_PASADA_POR_DEFECTO)
  })
})

describe('el orden y lo que entra en una pasada', () => {
  const factura = doc({
    id: '2026-9_FACTURA-F001-000007',
    tipoDoc: 'FACTURA',
    serie: 'F001',
    numero: 7,
    serieNumero: 'F001-000007',
    fecha: new Date(2026, 8, 23, 11, 0, 0, 0).toISOString(),
    sunat: { estado: 'pendiente', serie: 'F001', numero: 7 },
  })
  const nota = doc({
    id: '2026-9_NC-BC01-000003',
    tipoDoc: 'NC',
    serie: 'BC01',
    numero: 3,
    serieNumero: 'BC01-000003',
    fecha: new Date(2026, 8, 24, 12, 0, 0, 0).toISOString(),
    sunat: { estado: 'pendiente', serie: 'BC01', numero: 3 },
  })
  const boleta = doc()

  test('primero el comprobante, después la nota (una nota sin su original no se acepta)', () => {
    const orden = ordenarParaEnvioSunat([nota, boleta, factura], { ahora: AHORA })
    assert.deepEqual(orden.map((d) => d.tipoDoc), ['FACTURA', 'BOLETA', 'NC'])
  })

  test('dentro del mismo grupo, primero el que vence antes', () => {
    // La factura del 23 vence el 26; la boleta del 24, el 27.
    const orden = ordenarParaEnvioSunat([boleta, factura], { ahora: AHORA })
    assert.deepEqual(orden.map((d) => d.id), ['2026-9_FACTURA-F001-000007', '2026-9_BOLETA-B001-000042'])
  })

  test('el orden es estable: dos barridos no eligen cosas distintas', () => {
    const a = doc({ id: 'A' })
    const b = doc({ id: 'B' })
    const uno = ordenarParaEnvioSunat([a, b], { ahora: AHORA }).map((d) => d.id)
    const dos = ordenarParaEnvioSunat([b, a], { ahora: AHORA }).map((d) => d.id)
    assert.deepEqual(uno, dos)
  })

  test('la pasada trae solo lo que espera envío y se puede mandar', () => {
    const aceptado = doc({ id: 'aceptado', sunat: { estado: 'aceptado' } })
    const anulada = doc({ id: 'anulada', estado: 'anulada' })
    const vencida = doc({ id: 'vencida', fecha: new Date(2026, 8, 1, 10, 0, 0, 0).toISOString() })
    const nv = doc({ id: 'nv', tipoDoc: 'NV', sunat: null })
    const pendientes = pendientesDeEnvioSunat([boleta, factura, nota, aceptado, anulada, vencida, nv], { ahora: AHORA })
    // La vencida **espera** (hay que mirarla) y va **primero** —es lo más urgente—, pero **no se
    // manda** sola. Lo aceptado, lo anulado y una NV no aparecen en ninguna de las dos listas.
    assert.deepEqual(pendientes.map((d) => d.id), ['vencida', factura.id, boleta.id, nota.id])
    const aEnviar = elegirParaEnviarSunat([boleta, factura, nota, aceptado, anulada, vencida, nv], { ahora: AHORA })
    assert.deepEqual(aEnviar.map((d) => d.id), [factura.id, boleta.id, nota.id])
  })

  test('el tope por pasada se respeta, y `max: 0` significa sin tope', () => {
    const muchos = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      doc({ id: `d${i}`, numero: 100 + i, sunat: { estado: 'pendiente', serie: 'B001', numero: 100 + i } }),
    )
    assert.equal(elegirParaEnviarSunat(muchos, { ahora: AHORA }).length, MAX_POR_PASADA_POR_DEFECTO)
    assert.equal(elegirParaEnviarSunat(muchos, { ahora: AHORA, max: 2 }).length, 2)
    assert.equal(elegirParaEnviarSunat(muchos, { ahora: AHORA, max: 0 }).length, muchos.length)
  })
})

describe('el reclamo (para que dos pestañas no manden lo mismo)', () => {
  test('marca quién lo tomó, cuándo y suma un intento, sin perder el bloque anterior', () => {
    const bloque = camposDeReclamoSunat(doc({ sunat: { estado: 'error', serie: 'B001', numero: 42, intentos: 2 } }), {
      dispositivo: 'caja-1',
      ahora: AHORA,
    })
    assert.equal(bloque.estado, 'enviando')
    assert.equal(bloque.enviandoPor, 'caja-1')
    assert.equal(bloque.enviandoEn, new Date(AHORA).toISOString())
    assert.equal(bloque.intentos, 3)
    // El bloque anterior no se pierde: sin esto, el reclamo borraría la serie y el correlativo y el
    // envío mandaría otro número.
    assert.equal(bloque.serie, 'B001')
    assert.equal(bloque.numero, 42)
  })

  test('tomado con el reclamo, el mismo documento no se vuelve a mandar', () => {
    const tomado: DocumentoSunat = { ...doc(), sunat: camposDeReclamoSunat(doc(), { dispositivo: 'caja-1', ahora: AHORA }) }
    assert.equal(motivoNoEnviarSunat(tomado, { ahora: AHORA + 30 * 1000 }), 'en-envio')
  })
})

describe('la etiqueta del aviso', () => {
  test('serie-correlativo con ceros a la izquierda; el resto, el respaldo', () => {
    assert.equal(etiquetaSunat(doc()), 'B001-000042')
    assert.equal(etiquetaSunat(doc({ sunat: null, numero: null, serie: undefined, serieNumero: 'NV01-000173' })), 'NV01-000173')
    assert.equal(etiquetaSunat({ id: 'x' }), 'x')
  })
})
