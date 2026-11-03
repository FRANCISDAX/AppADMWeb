/**
 * 🩺 **Estado del sistema** (`lib/servicios.ts`) — las cuatro tarjetas de Auditoría → Estado.
 *
 * Lo que se fija acá es lo que puede mentir:
 *
 * - **«sin datos» NO es «caído»** (un negocio nuevo no tiene respaldo; el celular nunca latió);
 * - el umbral de la caja es **flojo a propósito** (un domingo o un feriado largo sin ventas es normal)
 *   y el de una semana **sí** es una alarma;
 * - la API distingue **no contesta** (crítico) de **contesta raro** y **contesta lento** (atención);
 * - el puente y el respaldo **no se reescriben acá**: se usan sus reglas, así que la pantalla nueva dice
 *   lo mismo que el PDV y que Mis Datos;
 * - la frase del encabezado **no puede decir «todo bien»** mientras algo se está probando.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  COLORES_SERVICIO,
  HORAS_WEB_ATENCION,
  HORAS_WEB_CRITICO,
  LATENCIA_LENTA_MS,
  PING_CODIGO_ESPERADO,
  PING_RUTA,
  etiquetaDeDocumento,
  horasEntre,
  resumenSistema,
  servicioApi,
  servicioPuente,
  servicioRespaldo,
  servicioWeb,
  type PingApi,
  type Servicio,
} from './servicios.ts'
import { baseDeLaApi, construirUrlApiSunat } from './sunat.ts'

const HORA = 3600000
const AHORA = Date.UTC(2026, 10, 2, 15, 0, 0) // 02/11/2026 15:00 UTC

const haceHoras = (h: number) => new Date(AHORA - h * HORA).toISOString()

const ping = (parcial: Partial<PingApi>): PingApi => ({
  ok: true,
  latenciaMs: 200,
  codigo: PING_CODIGO_ESPERADO,
  error: null,
  cuando: AHORA,
  ...parcial,
})

describe('🩺 Estado del sistema — la caja web', () => {
  it('sin movimientos es «sin-datos», NUNCA «caído»', () => {
    const s = servicioWeb(null, AHORA)
    assert.equal(s.nivel, 'sin-datos')
    assert.notEqual(s.nivel, 'critico')
    assert.match(s.accion, /Errores/)
  })

  it('una fecha vacía o rota no inventa una fecha', () => {
    assert.equal(servicioWeb({ fecha: '', etiqueta: 'x' }, AHORA).nivel, 'sin-datos')
    assert.equal(servicioWeb({ fecha: 'no-es-fecha', etiqueta: 'x' }, AHORA).nivel, 'sin-datos')
  })

  it('con movimientos recientes está bien y muestra cuál fue', () => {
    const s = servicioWeb({ fecha: haceHoras(2), etiqueta: 'Boleta B001-00000103 · S/ 1.00' }, AHORA)
    assert.equal(s.nivel, 'ok')
    assert.match(s.titulo, /registrando/)
    assert.match(s.detalle, /B001-00000103/)
    assert.match(s.detalle, /hace 2 h/)
    assert.equal(s.accion, '')
  })

  it(`el umbral es flojo: ${HORAS_WEB_ATENCION} h ya avisa pero ${HORAS_WEB_ATENCION - 1} h no`, () => {
    assert.equal(servicioWeb({ fecha: haceHoras(HORAS_WEB_ATENCION - 1), etiqueta: 'x' }, AHORA).nivel, 'ok')
    assert.equal(servicioWeb({ fecha: haceHoras(HORAS_WEB_ATENCION), etiqueta: 'x' }, AHORA).nivel, 'atencion')
  })

  it(`una semana sin un solo movimiento es crítico (${HORAS_WEB_CRITICO} h)`, () => {
    const s = servicioWeb({ fecha: haceHoras(HORAS_WEB_CRITICO), etiqueta: 'x' }, AHORA)
    assert.equal(s.nivel, 'critico')
    assert.match(s.accion, /una semana/i)
  })

  it('un reloj adelantado no da «hace −3 h»', () => {
    assert.equal(horasEntre(AHORA + 5 * HORA, AHORA), 0)
    assert.equal(horasEntre(0, AHORA), Number.POSITIVE_INFINITY)
    assert.equal(horasEntre(Number.NaN, AHORA), Number.POSITIVE_INFINITY)
  })

  it('el documento se nombra como lo reconoce la persona', () => {
    assert.equal(
      etiquetaDeDocumento({ tipoDoc: 'BOLETA', serie: 'B001', numero: 103, total: 1 }),
      'Boleta B001-000103 · S/ 1.00',
    )
    assert.equal(etiquetaDeDocumento({ tipoDoc: 'RETIRO', serie: 'B001', numero: 7, total: 0 }), 'Retiro sin cobro B001-000007 · S/ 0.00')
    assert.equal(etiquetaDeDocumento({ tipoDoc: 'PENDIENTE', serie: '', numero: 0 }), 'Pedido')
    assert.equal(etiquetaDeDocumento(null), '')
  })
})

describe('🩺 Estado del sistema — la API de SUNAT', () => {
  it('sin prueba todavía está «probando» (no se puede decir nada)', () => {
    const s = servicioApi(null, AHORA)
    assert.equal(s.nivel, 'probando')
    assert.match(s.detalle, /no se guarda/i)
  })

  it('el 422 esperado es «responde» (y dice cuánto tardó)', () => {
    const s = servicioApi(ping({ latenciaMs: 200 }), AHORA)
    assert.equal(s.nivel, 'ok')
    assert.match(s.detalle, /200 ms/)
    assert.equal(s.accion, '')
  })

  it('sin conexión es crítico: sin la API no se emite', () => {
    const s = servicioApi(ping({ ok: false, codigo: null, error: 'No se pudo conectar' }), AHORA)
    assert.equal(s.nivel, 'critico')
    assert.match(s.titulo, /no responde/i)
    assert.match(s.accion, /Configuración/)
  })

  it('un código inesperado (p. ej. 500 o 403) no es «caído» pero sí «revisar»', () => {
    const s = servicioApi(ping({ ok: false, codigo: 500 }), AHORA)
    assert.equal(s.nivel, 'atencion')
    assert.match(s.titulo, /500/)
  })

  it(`contestar lento (≥ ${LATENCIA_LENTA_MS} ms) es atención, no caída`, () => {
    const s = servicioApi(ping({ latenciaMs: LATENCIA_LENTA_MS + 1 }), AHORA)
    assert.equal(s.nivel, 'atencion')
    assert.match(s.titulo, /lento/)
    assert.ok(servicioApi(ping({ latenciaMs: LATENCIA_LENTA_MS - 1 }), AHORA).nivel === 'ok')
  })

  it('la prueba es un GET a /v1/dni sin número: la API contesta 422 sin consultar a nadie', () => {
    assert.equal(PING_RUTA, '/v1/dni')
    assert.equal(PING_CODIGO_ESPERADO, 422)
    // ⚠️ `GET /` NO sirve: API Gateway contesta 403 y sin cabeceras de CORS.
    assert.notEqual(PING_RUTA, '/')
  })
})

describe('🩺 Estado del sistema — puente de Yape y respaldo (reglas prestadas)', () => {
  it('el puente usa los umbrales del PDV (12 / 30 min) y `caido` se llama `critico` acá', () => {
    assert.equal(servicioPuente({ ultimoLatido: AHORA - 60 * 1000 }, AHORA).nivel, 'ok')
    assert.equal(servicioPuente({ ultimoLatido: AHORA - 20 * 60 * 1000 }, AHORA).nivel, 'atencion')
    assert.equal(servicioPuente({ ultimoLatido: AHORA - 40 * 60 * 1000 }, AHORA).nivel, 'critico')
    assert.equal(servicioPuente(null, AHORA).nivel, 'sin-datos')
  })

  it('el puente caído dice qué hacer con el celular', () => {
    const s = servicioPuente({ ultimoLatido: AHORA - 40 * 60 * 1000 }, AHORA)
    assert.match(s.accion, /celular/i)
    assert.equal(servicioPuente({ ultimoLatido: AHORA - 60 * 1000 }, AHORA).accion, '')
  })

  it('el respaldo sin datos avisa pero es «sin-datos», no «crítico»', () => {
    const s = servicioRespaldo(null, new Date(AHORA))
    assert.equal(s.nivel, 'sin-datos')
    assert.ok(s.accion.length > 0)
  })

  it('el respaldo sigue sus 36 h / 60 h', () => {
    const datos = (horas: number) => ({ fecha: new Date(AHORA - horas * HORA).toISOString(), ok: true })
    assert.equal(servicioRespaldo(datos(2), new Date(AHORA)).nivel, 'ok')
    assert.equal(servicioRespaldo(datos(40), new Date(AHORA)).nivel, 'atencion')
    assert.equal(servicioRespaldo(datos(70), new Date(AHORA)).nivel, 'critico')
    assert.equal(servicioRespaldo({ ...datos(2), ok: false, error: 'sin espacio' }, new Date(AHORA)).nivel, 'critico')
  })
})

describe('🩺 Estado del sistema — la frase del encabezado', () => {
  const servicio = (nivel: Servicio['nivel']): Servicio => ({ id: 'web', nombre: 'x', nivel, titulo: 't', detalle: '', accion: '' })

  it('todo bien lo dice', () => {
    const r = resumenSistema([servicio('ok'), servicio('ok'), servicio('ok'), servicio('ok')])
    assert.equal(r.peor, 'ok')
    assert.equal(r.frase, 'Los 4 servicios responden')
    assert.equal(r.pendientes, 0)
  })

  it('mientras algo se prueba NO dice «los 4 responden»', () => {
    const r = resumenSistema([servicio('ok'), servicio('ok'), servicio('ok'), servicio('probando')])
    assert.equal(r.pendientes, 0)
    assert.match(r.frase, /probando el resto/)
  })

  it('si nada contestó todavía, lo dice', () => {
    const r = resumenSistema([servicio('probando'), servicio('probando')])
    assert.equal(r.peor, 'probando')
    assert.match(r.frase, /Probando/)
  })

  it('lo caído manda sobre lo demás', () => {
    const r = resumenSistema([servicio('ok'), servicio('critico'), servicio('atencion'), servicio('sin-datos')])
    assert.equal(r.peor, 'critico')
    assert.match(r.frase, /caído/)
    assert.equal(r.pendientes, 3)
  })

  it('«sin datos» se cuenta como algo para revisar (y hay color para cada nivel)', () => {
    const r = resumenSistema([servicio('ok'), servicio('sin-datos')])
    assert.equal(r.pendientes, 1)
    assert.match(r.frase, /1 de 2 para revisar/)
    for (const nivel of ['ok', 'atencion', 'critico', 'sin-datos', 'probando'] as const) {
      assert.ok(COLORES_SERVICIO[nivel], `falta el color de ${nivel}`)
    }
  })
})

describe('🩺 Estado del sistema — la base de la API es una sola regla', () => {
  it('se le quita la ruta de emisión y las barras finales', () => {
    assert.equal(baseDeLaApi('https://x.execute-api.us-east-2.amazonaws.com/prod'), 'https://x.execute-api.us-east-2.amazonaws.com/prod')
    assert.equal(baseDeLaApi('https://x/prod/v1/invoices/emitir'), 'https://x/prod')
    assert.equal(baseDeLaApi('https://x/prod/v1/notes/emitir/'), 'https://x/prod')
    assert.equal(baseDeLaApi('  https://x/prod//  '), 'https://x/prod')
    assert.equal(baseDeLaApi(''), '')
  })

  it('el envío sigue armando la misma URL que antes', () => {
    assert.equal(construirUrlApiSunat('https://x/prod', 'invoices'), 'https://x/prod/v1/invoices/emitir')
    assert.equal(construirUrlApiSunat('https://x/prod/v1/invoices/emitir', 'invoices'), 'https://x/prod/v1/invoices/emitir')
    assert.equal(construirUrlApiSunat('https://x/prod', 'notes'), 'https://x/prod/v1/notes/emitir')
  })

  it('la prueba usa la base + su ruta (nunca la ruta de emisión)', () => {
    const url = `${baseDeLaApi('https://x/prod/v1/invoices/emitir')}${PING_RUTA}`
    assert.equal(url, 'https://x/prod/v1/dni')
    assert.equal(url.includes('/emitir'), false)
  })
})

describe('🛡️ Estado del sistema — solo INFORMA (no escribe, no bloquea)', () => {
  const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('el panel y su servicio no escriben en Firestore ni guardan la prueba', () => {
    for (const rel of ['../components/EstadoSistema.tsx', '../services/estado-sistema.ts']) {
      const src = leer(rel)
      for (const prohibido of ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'localStorage', 'sessionStorage']) {
        assert.equal(src.includes(prohibido), false, `${rel} no debería usar ${prohibido}`)
      }
    }
  })

  it('la prueba es un GET (no un POST a la ruta de emisión)', () => {
    const servicio = leer('../services/estado-sistema.ts')
    assert.match(servicio, /method: 'GET'/)
    assert.equal(servicio.includes('/v1/invoices/emitir'), false)
    assert.match(servicio, /signal: control\.signal/)
  })

  it('la pestaña «Estado» existe en Auditoría y monta el panel', () => {
    const pagina = leer('../pages/Auditoria.tsx')
    assert.match(pagina, /id: 'estado'/)
    assert.match(pagina, /<EstadoSistema \/>/)
    assert.match(pagina, /vista === 'estado'/)
  })

  it('la ruta del latido del respaldo se lee de `COL` (una sola definición)', () => {
    assert.match(leer('../components/EstadoRespaldo.tsx'), /COL\.RESPALDO_ESTADO/)
    assert.match(leer('../components/EstadoSistema.tsx'), /COL\.RESPALDO_ESTADO/)
  })
})
