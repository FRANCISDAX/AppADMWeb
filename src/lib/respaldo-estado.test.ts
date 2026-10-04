/**
 * **El latido del respaldo** (`lib/respaldo-estado.ts`).
 *
 * ⚠️ Lo que estos tests cuidan es que **el aviso diga la verdad**: si el respaldo dejó de correr, tiene
 * que verse; y si todo está bien, no puede quedar en rojo (una alerta que grita de más se ignora, y
 * entonces no sirve para lo único que existe: que el hueco del 01/10/2026 no vuelva a pasar inadvertido).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { HORAS_ATENCION, HORAS_CRITICO, estadoDelRespaldo, hace } from './respaldo-estado.ts'

const aca = dirname(fileURLToPath(import.meta.url))
const AHORA = new Date('2026-10-04T10:00:00.000Z')
/** Un latido de hace N horas. */
const haceHoras = (n: number) => new Date(AHORA.getTime() - n * 3600000).toISOString()
const bueno = (n: number) => ({ fecha: haceHoras(n), ok: true, documentos: 1488, colecciones: 26, tamanoMB: 6.57, auth: 'exportado' })

describe('respaldo — el respaldo que corrió bien', () => {
  it('anoche (12 h) está OK y no alerta', () => {
    const e = estadoDelRespaldo(bueno(12), AHORA)
    assert.equal(e.nivel, 'ok')
    assert.equal(e.alerta, false)
    assert.match(e.titulo, /Último respaldo: hace 12 h/)
  })

  it('el detalle dice qué se copió (documentos, colecciones, tamaño y cuentas)', () => {
    const e = estadoDelRespaldo(bueno(12), AHORA)
    assert.match(e.detalle, /1488 documentos/)
    assert.match(e.detalle, /26 colecciones/)
    assert.match(e.detalle, /6.57 MB/)
    assert.match(e.detalle, /cuentas de usuario/)
  })

  it('justo antes del umbral sigue OK (no grita por un rato de atraso)', () => {
    assert.equal(estadoDelRespaldo(bueno(HORAS_ATENCION - 1), AHORA).nivel, 'ok')
  })
})

describe('respaldo — cuando se atrasa o falla', () => {
  it(`🔑 a las ${HORAS_ATENCION} h ya avisa (se esperaba el de anoche)`, () => {
    const e = estadoDelRespaldo(bueno(HORAS_ATENCION), AHORA)
    assert.equal(e.nivel, 'atencion')
    assert.equal(e.alerta, true)
    assert.match(e.titulo, /El último respaldo fue/)
    assert.match(e.detalle, /quedó sin copia/i)
  })

  it(`🔑 a las ${HORAS_CRITICO} h es crítico (dos noches sin copia)`, () => {
    const e = estadoDelRespaldo(bueno(HORAS_CRITICO + 1), AHORA)
    assert.equal(e.nivel, 'critico')
    assert.equal(e.alerta, true)
    assert.match(e.detalle, /23:30/)
  })

  it('🔑 un respaldo que FALLÓ es crítico aunque haya corrido hace un rato', () => {
    const e = estadoDelRespaldo({ ...bueno(1), ok: false, error: 'no encuentro la llave de servicio' }, AHORA)
    assert.equal(e.nivel, 'critico')
    assert.match(e.titulo, /FALLÓ/)
    assert.match(e.detalle, /no encuentro la llave/)
  })

  it('el caso REAL del 01/10: la PC apagada ⇒ el título lo dice con días, no con horas', () => {
    const e = estadoDelRespaldo(bueno(50), AHORA)
    assert.equal(e.alerta, true)
    assert.match(e.titulo, /hace 2 días/)
  })
})

describe('respaldo — sin datos no es «todo bien»', () => {
  it('sin latido avisa que no hay ningún respaldo (un cliente nuevo, o la tarea que nunca corrió)', () => {
    for (const vacio of [null, {}, { fecha: '' }]) {
      const e = estadoDelRespaldo(vacio as never, AHORA)
      assert.equal(e.nivel, 'sin-datos')
      assert.equal(e.alerta, true, 'no tener respaldo NO puede verse como normal')
      assert.match(e.titulo, /Todavía no hay ningún respaldo/)
    }
  })

  it('una fecha ilegible no rompe la pantalla', () => {
    const e = estadoDelRespaldo({ fecha: 'no es una fecha', ok: true }, AHORA)
    assert.equal(e.nivel, 'sin-datos')
    assert.equal(e.alerta, true)
  })

  it('las horas se dicen en palabras', () => {
    assert.equal(hace(0.4), 'hace minutos')
    assert.equal(hace(3), 'hace 3 h')
    assert.equal(hace(25), 'ayer')
    assert.equal(hace(72), 'hace 3 días')
  })
})

/**
 * 🛡️ **Test-guarda del cableado**: que la tarjeta use esta regla (y no su propia cuenta de horas), y que
 * la herramienta de respaldo **escriba el latido** en la colección que la regla de Firestore permite leer.
 * Si el respaldo dejara de avisar, la tarjeta diría «todavía no hay ningún respaldo» para siempre.
 */
describe('🛡️ el latido viaja del respaldo al app', () => {
  const tarjeta = readFileSync(join(aca, '..', 'components', 'EstadoRespaldo.tsx'), 'utf8')
  const herramienta = readFileSync('C:/Users/aaval/appadm-backup/respaldar.mjs', 'utf8')
  const reglas = readFileSync(join(aca, '..', '..', 'firestore.rules'), 'utf8')
  const auditoria = readFileSync(join(aca, '..', 'pages', 'Auditoria.tsx'), 'utf8')

  it('la tarjeta usa la regla pura', () => {
    assert.match(tarjeta, /estadoDelRespaldo\(/)
    assert.match(tarjeta, /tblRespaldoEstado/)
  })

  it('🔑 la tarjeta y la exportación viven en Auditoría (no quedan huérfanas)', () => {
    // Decisión del usuario (04/10/2026): «Mis Datos» se movió de Facturación a **Auditoría**. Este test
    // falla si alguien mueve el archivo y se olvida de montarlo en algún lado.
    assert.match(auditoria, /EstadoRespaldo/)
    assert.match(auditoria, /ExportarDatos/)
    assert.match(auditoria, /label: 'Mis Datos'/)
  })

  it('la herramienta de respaldo deja el latido, con el id = el proyecto', () => {
    assert.match(herramienta, /tblRespaldoEstado/)
    assert.match(herramienta, /\.doc\(cliente\.proyecto\)/)
    assert.match(herramienta, /avisarLatido\(cliente/)
    // ⚠️ Un fallo del latido NO puede tumbar el respaldo.
    assert.match(herramienta, /no se pudo avisar el latido/)
  })

  it('🔑 el latido informa lo que copió (el «0 colecciones» que se coló una vez)', () => {
    // 📌 La primera versión escribía «0 colecciones · 0 MB» porque no se pasaban esos datos a la función.
    const llamada = herramienta.slice(herramienta.indexOf('await avisarLatido(cliente, {'), herramienta.indexOf('await avisarLatido(cliente, {') + 400)
    assert.match(llamada, /colecciones: r\.colecciones/)
    assert.match(llamada, /tamanoMB: r\.tamanoMB/)
    assert.match(llamada, /documentos: r\.documentos/)
  })

  it('la regla deja leerlo y NO deja escribirlo desde el app', () => {
    assert.match(reglas, /match \/tblRespaldoEstado\//)
    const bloque = reglas.slice(reglas.indexOf('match /tblRespaldoEstado/'))
    const cuerpo = bloque.slice(0, bloque.indexOf('\n    }'))
    assert.match(cuerpo, /allow read:/)
    assert.match(cuerpo, /allow write: if false/)
  })
})
