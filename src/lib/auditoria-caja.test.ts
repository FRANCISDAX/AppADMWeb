/**
 * **Auditoría de caja por rubro** (`lib/auditoria-caja.ts`): totales por rubro de las cajas cerradas y las
 * **pistas** que ayudan a deducir un faltante o un sobrante.
 *
 * 🔑 Lo que estos tests protegen:
 *  1. el efectivo **se cuenta** (esperado vs contado) y las transferencias **no** (se cruzan por medio contra lo
 *     declarado al cerrar): mezclarlos esconde justo lo que se audita;
 *  2. el rubro de un medio **se recalcula de los items** (no se confía en el total guardado del turno);
 *  3. **no se inventa** un `declarado`: si no hubo conciliación, el medio queda *sin conciliar*;
 *  4. las pistas salen de los **datos del cierre** (importe exacto, duplicados, redondos, cruce entre rubros) y
 *     si no hay nada que diga, la pista lo dice en vez de callarse.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { origenDelEfectivo, pistasDelCierre, resumenPorRubro, signoDe } from './auditoria-caja.ts'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const venta = (serie: string, total: number, extra: Record<string, unknown> = {}) => ({
  serie_numero: serie,
  total,
  tipoPago: 'efectivo',
  pagos: [{ tipo: 'efectivo', medio: 'efectivo', monto: total }],
  fecha: '2026-10-30T15:00:00.000Z',
  ...extra,
})

describe('auditoría por rubro — efectivo y transferencias SEPARADOS', () => {
  it('suma el efectivo (se cuenta) y cada medio (se cruza), sin mezclarlos', () => {
    const r = resumenPorRubro([
      {
        montoInicial: 100,
        totalVentas: 300,
        totalEfectivo: 150,
        totalTransferencia: 150,
        totalGastosEfectivo: 20,
        efectivoEsperado: 230,
        montoFinalEfectivo: 230,
        diferencia: 0,
        ventas: [
          venta('B001-000001', 100),
          venta('B001-000002', 50, { tipoPago: 'yape', pagos: [{ medio: 'yape', monto: 50 }] }),
          venta('B001-000003', 100, { tipoPago: 'yape', pagos: [{ medio: 'yape', monto: 100 }] }),
          venta('B001-000004', 50, { tipoPago: 'tarjeta', pagos: [{ medio: 'tarjeta', monto: 50 }] }),
        ],
      },
    ])
    assert.equal(r.efectivo.fondo, 100)
    assert.equal(r.efectivo.ventas, 150)
    assert.equal(r.efectivo.gastos, 20)
    assert.equal(r.efectivo.esperado, 230)
    assert.equal(r.efectivo.contado, 230)
    assert.equal(r.efectivo.diferencia, 0)
    assert.equal(r.efectivo.conDiferencia, 0)
    assert.equal(r.transferencia.total, 150)
    // Los medios salen de los ITEMS (no del total guardado).
    const yape = r.transferencia.medios.find((m) => m.medio === 'yape')
    const tarjeta = r.transferencia.medios.find((m) => m.medio === 'tarjeta')
    assert.equal(yape?.sistema, 150)
    assert.equal(yape?.declarado, null, 'sin conciliación no se inventa un declarado')
    assert.equal(yape?.diferencia, null)
    assert.equal(tarjeta?.sistema, 50)
    assert.equal(r.transferencia.conciliado, false)
  })

  it('con conciliación declarada, cada medio muestra su diferencia y su estado', () => {
    const r = resumenPorRubro([
      {
        totalTransferencia: 120,
        conciliacion: { yape: { sistema: 120, declarado: 100, diferencia: -20 } },
        ventas: [venta('B001-000001', 120, { tipoPago: 'yape', pagos: [{ medio: 'yape', monto: 120 }] })],
      },
    ])
    const yape = r.transferencia.medios.find((m) => m.medio === 'yape')
    assert.equal(yape?.sistema, 120)
    assert.equal(yape?.declarado, 100)
    assert.equal(yape?.diferencia, -20) // declarado − sistema = falta plata en ese medio
    assert.equal(r.transferencia.conciliado, true)
    assert.equal(signoDe(yape?.diferencia), 'faltante')
  })

  it('cuenta los cierres con diferencia y los que cuadran', () => {
    const r = resumenPorRubro([
      { diferencia: 0, efectivoEsperado: 10, montoFinalEfectivo: 10 },
      { diferencia: -15, efectivoEsperado: 100, montoFinalEfectivo: 85 },
      { diferencia: 3, efectivoEsperado: 50, montoFinalEfectivo: 53 },
    ])
    assert.equal(r.cierres, 3)
    assert.equal(r.efectivo.conDiferencia, 2)
    assert.equal(r.efectivo.diferencia, -12)
    // La suma de las partes tiene que dar el total guardado (no se inventa nada).
    assert.equal(r.efectivo.contado, 148)
    assert.equal(r.efectivo.esperado, 160)
  })

  it('sin cierres devuelve ceros (no rompe la pantalla)', () => {
    const r = resumenPorRubro([])
    assert.equal(r.cierres, 0)
    assert.deepEqual(r.efectivo, { cierres: 0, fondo: 0, ventas: 0, gastos: 0, esperado: 0, contado: 0, diferencia: 0, conDiferencia: 0 })
    assert.deepEqual(r.transferencia.medios, [])
  })
})

describe('🛡️ la pantalla pide el MES y los totales son del mes', () => {
  const pagina = leer('../pages/AuditoriaCaja.tsx')

  it('hay un selector de mes (`type="month"`) y arranca en el mes actual', () => {
    assert.match(pagina, /type="month"/)
    assert.match(pagina, /id="auditoria-mes"/)
    assert.match(pagina, /useState\(mesDeHoy\(\)\)/)
  })

  it('la consulta se acota al mes (no baja el año entero)', () => {
    assert.match(pagina, /where\('createdAt', '>=', rango\.desdeISO\)/)
    assert.match(pagina, /where\('createdAt', '<', rango\.hastaISO\)/)
    assert.match(pagina, /\[mes\]\)/)
    // El corte es por día LOCAL, no por el texto del input.
    assert.match(pagina, /new Date\(y, m - 1, 1, 0, 0, 0, 0\)/)
  })

  it('el bloque de totales dice de qué mes es', () => {
    assert.match(pagina, /Totales por rubro · \{mes\}/)
  })
})

describe('auditoría por rubro — pistas para deducir qué pasó', () => {
  const cierreBase = {
    montoInicial: 0,
    totalEfectivo: 100,
    efectivoEsperado: 100,
    totalGastosEfectivo: 0,
    ventas: [venta('B001-000001', 60), venta('B001-000002', 40)],
  }

  it('si cuadra, no inventa pistas', () => {
    assert.deepEqual(pistasDelCierre({ ...cierreBase, montoFinalEfectivo: 100 }), [])
  })

  it('🔑 un documento por el importe EXACTO de la diferencia es la pista más fuerte', () => {
    // Contó 40 de 100: falta S/ 60, que es exactamente la venta B001-000001.
    const pistas = pistasDelCierre({ ...cierreBase, montoFinalEfectivo: 40 })
    const fuerte = pistas.find((p) => p.fuerza === 'fuerte' && p.rubro === 'efectivo')
    assert.ok(fuerte, 'tiene que encontrar la venta de S/ 60')
    assert.equal(pistas[0].signo, 'faltante')
    assert.equal(pistas[0].monto, 60)
  })

  it('si falta justo el importe de una venta, la nombra', () => {
    const pistas = pistasDelCierre({ ...cierreBase, montoFinalEfectivo: 60 }) // falta S/ 40 = B001-000002
    const p = pistas.find((x) => x.documentos.includes('B001-000002'))
    assert.ok(p, 'la pista tiene que nombrar B001-000002')
    assert.equal(p?.fuerza, 'fuerte')
    assert.match(String(p?.texto), /exactamente ese importe/)
  })

  it('🔗 cruza rubros: lo que falta en Yape es lo que sobra en efectivo', () => {
    const pistas = pistasDelCierre({
      montoInicial: 0,
      totalEfectivo: 120,
      totalTransferencia: 120,
      efectivoEsperado: 100,
      totalGastosEfectivo: 0,
      montoFinalEfectivo: 120, // sobran S/ 20 en el cajón
      ventas: [venta('B001-000001', 120, { tipoPago: 'yape', pagos: [{ medio: 'yape', monto: 120 }] })],
      conciliacion: { yape: { sistema: 120, declarado: 100, diferencia: -20 } }, // faltan S/ 20 en Yape
    })
    const cruce = pistas.find((p) => p.rubro === 'cruce')
    assert.ok(cruce, 'la pista del cruce entre rubros es la que resuelve el caso')
    assert.equal(cruce?.fuerza, 'fuerte')
    assert.match(String(cruce?.texto), /Se cruzan/)
  })

  it('un sobrante con dos ventas del mismo importe sugiere cobro duplicado', () => {
    const pistas = pistasDelCierre({
      montoInicial: 0,
      totalEfectivo: 60,
      efectivoEsperado: 40,
      totalGastosEfectivo: 0,
      montoFinalEfectivo: 60, // sobran S/ 20
      ventas: [venta('B001-000001', 20), venta('B001-000002', 20)],
    })
    const p = pistas.find((x) => /duplicado/.test(String(x.texto)))
    assert.ok(p, 'dos ventas iguales + sobrante = posible duplicado')
  })

  it('un faltante sin coincidencias igual dice qué mirar (no se calla)', () => {
    const pistas = pistasDelCierre({
      montoInicial: 0,
      totalEfectivo: 500,
      efectivoEsperado: 500,
      totalGastosEfectivo: 0,
      montoFinalEfectivo: 487.35,
      ventas: [venta('B001-000001', 250.1), venta('B001-000002', 249.9)],
    })
    assert.ok(pistas.length > 0)
    assert.match(String(pistas[0].texto), /compará el conteo/i)
  })

  it('el origen del efectivo separa ventas, cobranzas y notas', () => {    const o = origenDelEfectivo({
      totalEfectivo: 90, // 80 de ventas + 20 de un cobro − 10 de una NC
      ventas: [
        venta('B001-000001', 80),
        { serie_numero: 'R-1', total: 20, tipo: 'cobro_credito', medio: 'efectivo' },
        { serie_numero: 'B001-000009', total: -10, tipoDoc: 'NC', tipoPago: 'efectivo', pagos: [{ medio: 'efectivo', monto: -10 }] },
      ],
    })
    assert.equal(o.find((l) => l.origen === 'cobranzas')?.monto, 20, 'el cobro de crédito en efectivo entra aparte')
    // 🔑 Las tres partes SIEMPRE suman el total guardado del bolsillo (ventas es el residuo).
    const suma = o.reduce((s, l) => s + l.monto, 0)
    assert.equal(Number(suma.toFixed(2)), 90)
  })
})
