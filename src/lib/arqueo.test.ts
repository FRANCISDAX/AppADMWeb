/**
 * Tests del desglose por origen del turno (`lib/arqueo.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 *
 * Los casos están tomados de datos REALES de producción (turno del 14/09/2026 y del
 * 06/09/2026), no de ejemplos inventados: son los que revelaron que la fila
 * "Ventas transferencia" estaba mostrando una cobranza como si fuera venta.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { desglosarTurno, efectivoEsperadoDe, lineasDeOrigen, sumarDesgloses, type ItemTurno } from './arqueo.ts'

describe('efectivoEsperadoDe — la fórmula única del arqueo', () => {
  it('fondo + efectivo − gastos (el caso normal)', () => {
    assert.equal(efectivoEsperadoDe({ montoInicial: 10, totalEfectivo: 2, totalGastosEfectivo: 0 }), 12)
  })

  it('resta los gastos de efectivo', () => {
    assert.equal(efectivoEsperadoDe({ montoInicial: 10, totalEfectivo: 50, totalGastosEfectivo: 8.5 }), 51.5)
  })

  it('⚠️ resta el vuelto por transferencia (lo que faltaba en 2 de los 6 lugares)', () => {
    // Este es el caso que dejaba al cajero viendo un "Debería haber" distinto al guardado.
    assert.equal(efectivoEsperadoDe({ montoInicial: 10, totalEfectivo: 40, totalGastosEfectivo: 0, vueltoTransferencia: 15 }), 35)
  })

  it('las transferencias no entran (no hay campo: no puede sumarlas por error)', () => {
    assert.equal(efectivoEsperadoDe({ montoInicial: 0, totalEfectivo: 0, totalGastosEfectivo: 0 }), 0)
  })

  it('campos ausentes o basura cuentan como 0', () => {
    assert.equal(efectivoEsperadoDe({}), 0)
    assert.equal(efectivoEsperadoDe({ montoInicial: NaN, totalEfectivo: undefined }), 0)
  })
})

/** Venta simple: tal como la escribe `services/ventas.ts` cuando no hay pago múltiple. */
function venta(total: number, tipoPago: string, extra: Partial<ItemTurno> = {}): ItemTurno {
  return { total, tipoPago, ...extra }
}

/** Cobro de crédito: la forma que le da `services/clientes.ts`. */
function cobro(monto: number, tipoPago: string): ItemTurno {
  return { tipo: 'cobro_credito', monto, total: monto, tipoPago }
}

describe('desglosarTurno — el caso real del 14/09/2026', () => {
  // Turno lLhxGXTo5nueulyj7Qix: 1 venta de S/ 2.00 en efectivo + cobranza de S/ 47.00 por Yape.
  const turno = {
    totalEfectivo: 2,
    totalTransferencia: 47,
    ventasDelTurno: [
      venta(2, 'efectivo', { pagos: [{ tipo: 'efectivo', monto: 2 }] }),
      cobro(47, 'yape'),
    ],
  }

  it('el efectivo es todo ventas del día', () => {
    const d = desglosarTurno(turno)
    assert.deepEqual(d.efectivo, { total: 2, ventas: 2, cobranzas: 0, notas: 0 })
  })

  it('la transferencia NO es venta: los S/ 47 son cobranza de crédito', () => {
    const d = desglosarTurno(turno)
    assert.deepEqual(d.transferencia, { total: 47, ventas: 0, cobranzas: 47, notas: 0 })
  })

  it('las tres partes suman el total guardado (nada se mueve de lugar)', () => {
    const d = desglosarTurno(turno)
    assert.equal(d.consistente, true)
    for (const b of [d.efectivo, d.transferencia]) {
      assert.equal(Math.round((b.ventas + b.cobranzas + b.notas) * 100) / 100, b.total)
    }
  })

  it('los orígenes en cero no generan líneas (no ensucian la UI en el caso normal)', () => {
    const d = desglosarTurno(turno)
    assert.deepEqual(lineasDeOrigen(d.efectivo), [{ origen: 'ventas', label: 'ventas', monto: 2 }])
    assert.deepEqual(lineasDeOrigen(d.transferencia), [{ origen: 'cobranzas', label: 'cobranza de crédito', monto: 47 }])
  })
})

describe('desglosarTurno — cobranza en efectivo (06/09/2026)', () => {
  // En ese turno el cobro fue en efectivo: por eso sí aparecía en el arqueo.
  const turno = {
    totalEfectivo: 19,
    totalTransferencia: 0,
    ventasDelTurno: [cobro(12, 'efectivo'), cobro(5, 'efectivo'), cobro(2, 'efectivo')],
  }

  it('las cobranzas en efectivo se separan de las ventas', () => {
    const d = desglosarTurno(turno)
    assert.deepEqual(d.efectivo, { total: 19, ventas: 0, cobranzas: 19, notas: 0 })
    assert.equal(d.transferencia.total, 0)
  })
})

describe('desglosarTurno — una venta a crédito no entra a ningún bolsillo', () => {
  // ⚠️ Regresión: `bolsilloDe('credito')` devolvía 'efectivo' (porque caía al primer
  // medio de la lista) y la venta al fiado inflaba el efectivo de la caja.
  const turno = {
    totalEfectivo: 0,
    totalTransferencia: 0,
    ventasDelTurno: [venta(59, 'credito')],
  }

  it('crédito: 0 en efectivo y 0 en transferencia (queda por cobrar)', () => {
    const d = desglosarTurno(turno)
    assert.equal(d.efectivo.total, 0)
    assert.equal(d.transferencia.total, 0)
    assert.equal(d.efectivo.ventas, 0)
    assert.equal(d.transferencia.ventas, 0)
    assert.equal(d.consistente, true)
  })

  it('un pago con tipo credito dentro de pagos tampoco entra', () => {
    const d = desglosarTurno({
      totalEfectivo: 0,
      totalTransferencia: 0,
      ventasDelTurno: [venta(59, 'credito', { pagos: [{ tipo: 'credito', monto: 59 }] })],
    })
    assert.equal(d.efectivo.ventas, 0)
    assert.equal(d.transferencia.ventas, 0)
  })
})

describe('desglosarTurno — pago múltiple y medios', () => {
  it('una venta mixta se reparte por bolsillo', () => {
    const d = desglosarTurno({
      totalEfectivo: 30,
      totalTransferencia: 20,
      ventasDelTurno: [venta(50, 'mixto', { pagos: [{ tipo: 'efectivo', monto: 30 }, { tipo: 'transferencia', medio: 'yape', monto: 20 }] })],
    })
    assert.equal(d.efectivo.ventas, 30)
    assert.equal(d.transferencia.ventas, 20)
    assert.equal(d.consistente, true)
  })

  it('Yape, Plin y tarjeta van al bolsillo transferencia', () => {
    const d = desglosarTurno({
      totalEfectivo: 0,
      totalTransferencia: 30,
      ventasDelTurno: [
        venta(10, 'yape', { pagos: [{ tipo: 'transferencia', medio: 'yape', monto: 10 }] }),
        venta(10, 'plin', { pagos: [{ tipo: 'transferencia', medio: 'plin', monto: 10 }] }),
        venta(10, 'tarjeta', { pagos: [{ tipo: 'transferencia', medio: 'tarjeta', monto: 10 }] }),
      ],
    })
    assert.equal(d.transferencia.ventas, 30)
    assert.equal(d.efectivo.ventas, 0)
  })

  it('sin `pagos` (documentos viejos y app móvil) se cae a tipoPago', () => {
    const d = desglosarTurno({
      totalEfectivo: 5,
      totalTransferencia: 7,
      ventasDelTurno: [venta(5, 'efectivo'), venta(7, 'transferencia')],
    })
    assert.equal(d.efectivo.ventas, 5)
    assert.equal(d.transferencia.ventas, 7)
  })
})

describe('desglosarTurno — notas de crédito y débito', () => {
  it('la NC resta del bolsillo del pago original', () => {
    const d = desglosarTurno({
      totalEfectivo: 5,
      totalTransferencia: 10,
      ventasDelTurno: [
        venta(10, 'efectivo'),
        { tipo: 'nota_credito', total: -5, tipoPago: 'efectivo' },
        venta(10, 'transferencia'),
      ],
    })
    assert.equal(d.efectivo.ventas, 10)
    assert.equal(d.efectivo.notas, -5)
    assert.equal(d.efectivo.total, 5)
    assert.equal(d.transferencia.ventas, 10)
  })

  it('la NC de un pago mixto sale del efectivo (igual que services/notas.ts)', () => {
    const d = desglosarTurno({
      totalEfectivo: 5,
      totalTransferencia: 0,
      ventasDelTurno: [
        venta(10, 'efectivo'),
        { tipo: 'nota_credito', total: -5, tipoPago: 'mixto' },
      ],
    })
    assert.equal(d.efectivo.notas, -5)
    assert.equal(d.transferencia.notas, 0)
  })
})

describe('desglosarTurno — items anulados y consistencia', () => {
  it('las ventas anuladas no se cuentan (el arqueo también las descarta)', () => {
    const d = desglosarTurno({
      totalEfectivo: 10,
      totalTransferencia: 0,
      ventasDelTurno: [
        venta(10, 'efectivo'),
        { ...venta(99, 'efectivo'), estado: 'anulada' },
      ],
    })
    assert.equal(d.efectivo.ventas, 10)
    assert.equal(d.consistente, true)
  })

  it('si el total guardado no cuadra con los items, el residuo lo absorbe y avisa', () => {
    // Turno cerrado con una anulación posterior: el total NO se descontó (se acumula en
    // `totalAnulado*`), así que el desglose queda por debajo y lo absorbe `ventas`.
    const d = desglosarTurno({
      totalEfectivo: 100,
      totalTransferencia: 0,
      ventasDelTurno: [venta(100, 'efectivo', { estado: 'anulada' })],
    })
    assert.equal(d.consistente, false)
    assert.equal(d.efectivo.total, 100)
    assert.equal(d.efectivo.ventas, 100, 'el total manda')
    assert.equal(d.efectivo.ventas + d.efectivo.cobranzas + d.efectivo.notas, 100)
  })
})

describe('sumarDesgloses', () => {
  it('suma varios turnos del día y baja la bandera de consistencia', () => {
    const dia = sumarDesgloses([
      desglosarTurno({ totalEfectivo: 2, totalTransferencia: 47, ventasDelTurno: [venta(2, 'efectivo'), cobro(47, 'yape')] }),
      desglosarTurno({ totalEfectivo: 10, totalTransferencia: 0, ventasDelTurno: [venta(10, 'efectivo')] }),
    ])
    assert.equal(dia.efectivo.total, 12)
    assert.equal(dia.efectivo.ventas, 12)
    assert.equal(dia.transferencia.total, 47)
    assert.equal(dia.transferencia.cobranzas, 47)
    assert.equal(dia.consistente, true)
  })

  it('sin turnos queda todo en cero', () => {
    const vacio = sumarDesgloses([])
    assert.deepEqual(vacio.efectivo, { total: 0, ventas: 0, cobranzas: 0, notas: 0 })
    assert.equal(vacio.consistente, true)
  })
})
