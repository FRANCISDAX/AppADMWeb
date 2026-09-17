import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  bolsilloDe,
  bolsillosDeVenta,
  etiquetaPago,
  formaPagoLabel,
  infoMedio,
  medioDeVenta,
  normalizarMonto,
  resumenPagos,
  tipoPagoDe,
  topeSugerido,
  type PagoEntrada,
} from './pagos.ts'

const pago = (medio: PagoEntrada['medio'], monto: number, operacion?: string): PagoEntrada => ({
  id: `${medio}-${monto}`,
  medio,
  monto,
  ...(operacion ? { operacion } : {}),
})

test('el bolsillo manda todo lo electrónico a transferencia y el efectivo a caja', () => {
  assert.equal(bolsilloDe('efectivo'), 'efectivo')
  assert.equal(bolsilloDe('yape'), 'transferencia')
  assert.equal(bolsilloDe('plin'), 'transferencia')
  assert.equal(bolsilloDe('transferencia'), 'transferencia')
  assert.equal(bolsilloDe('tarjeta'), 'transferencia')
  assert.equal(bolsilloDe('cualquier-cosa'), 'credito', 'un medio desconocido NO entra a la caja: si cayera a efectivo, inflaría el cajón')
})

// `medioDeVenta` es lo que permite que una nota herede el medio del comprobante original
// (sin esto, una NC de una venta por Yape quedaba como "Transferencia (sin detalle)").
test('medioDeVenta: el medio real de una venta, o undefined si no hay dato', () => {
  assert.equal(medioDeVenta({ pagos: [{ tipo: 'transferencia', medio: 'yape', monto: 10 }] }), 'yape')
  assert.equal(medioDeVenta({ pagos: [{ tipo: 'transferencia', monto: 10 }] }), undefined, 'sin `medio` no se inventa: puede ser Yape, Plin o el banco')
  assert.equal(medioDeVenta({ pagos: [{ tipo: 'efectivo', monto: 10 }, { tipo: 'transferencia', medio: 'yape', monto: 5 }] }), 'mixto')
  assert.equal(medioDeVenta({ pagos: [] }), undefined)
  assert.equal(medioDeVenta(undefined), undefined)
})

test('solo los medios electrónicos piden N° de operación', () => {
  assert.equal(infoMedio('efectivo').pideOperacion, false)
  assert.equal(infoMedio('yape').pideOperacion, true)
  assert.equal(infoMedio('tarjeta').pideOperacion, true)
})

// ⚠️ Regresión (bug real encontrado el 16/09/2026): `bolsilloDe` caía a `infoMedio`, que
// ante un medio desconocido devuelve el PRIMER medio de la lista (efectivo). Entonces
// `bolsilloDe('credito')` daba 'efectivo' y una venta al fiado se sumaba al efectivo de la
// caja: el arqueo mostraba un faltante igual al crédito. El test viejo lo aprobaba
// ('un medio desconocido no rompe'), así que la regla equivocada estaba "documentada".
test('el crédito no entra a ningún bolsillo: no deja plata en el cajón', () => {
  assert.equal(bolsilloDe('credito'), 'credito')
  assert.equal(bolsilloDe('CREDITO'), 'credito')
  assert.equal(bolsilloDe(''), 'credito')
  assert.equal(bolsilloDe('mixto'), 'credito', 'un mixto sin `pagos` no se puede repartir')
})

test('bolsillosDeVenta: reparte por `pagos` y deja el crédito fuera', () => {
  assert.deepEqual(
    bolsillosDeVenta({ tipoPago: 'mixto', total: 50, pagos: [{ tipo: 'efectivo', monto: 30 }, { tipo: 'transferencia', medio: 'yape', monto: 20 }] }),
    { efectivo: 30, transferencia: 20 },
  )

  assert.deepEqual(bolsillosDeVenta({ tipoPago: 'efectivo', total: 12 }), { efectivo: 12, transferencia: 0 })
  assert.deepEqual(bolsillosDeVenta({ tipoPago: 'transferencia', total: 12 }), { efectivo: 0, transferencia: 12 })
  assert.deepEqual(bolsillosDeVenta({ tipoPago: 'yape', total: 12 }), { efectivo: 0, transferencia: 12 })
  assert.deepEqual(bolsillosDeVenta({ tipoPago: 'credito', total: 59 }), { efectivo: 0, transferencia: 0 }, 'una venta a crédito no entra a la caja')
  assert.deepEqual(bolsillosDeVenta({ tipoPago: 'credito', total: 59, pagos: [{ tipo: 'credito', monto: 59 }] }), { efectivo: 0, transferencia: 0 })
  assert.deepEqual(bolsillosDeVenta({ total: 0 }), { efectivo: 0, transferencia: 0 })
})

test('un solo pago en efectivo por el total: cobrable y sin vuelto', () => {
  const r = resumenPagos({ pagos: [pago('efectivo', 100)], total: 100 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.vuelto, 0)
  assert.equal(r.falta, 0)
  assert.deepEqual(r.pagos, [{ tipo: 'efectivo', medio: 'efectivo', monto: 100 }])
})

test('el efectivo puede superar el total y el excedente es el vuelto', () => {
  const r = resumenPagos({ pagos: [pago('efectivo', 100)], total: 80 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.efectivoRecibido, 100)
  assert.equal(r.efectivoAplicado, 80)
  assert.equal(r.vuelto, 20)
  assert.deepEqual(r.pagos, [{ tipo: 'efectivo', medio: 'efectivo', monto: 80 }], 'se guarda el aplicado, no lo recibido')
})

test('ejemplo del video: 50 en efectivo + 50 por transferencia sobre 100', () => {
  const r = resumenPagos({ pagos: [pago('efectivo', 50), pago('transferencia', 50, 'OP-1')], total: 100 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.vuelto, 0)
  assert.deepEqual(r.pagos, [
    { tipo: 'transferencia', medio: 'transferencia', monto: 50, operacion: 'OP-1' },
    { tipo: 'efectivo', medio: 'efectivo', monto: 50 },
  ])
  assert.equal(tipoPagoDe(r.pagos), 'mixto')
})

test('se pueden combinar tres medios distintos', () => {
  const r = resumenPagos({ pagos: [pago('yape', 30), pago('tarjeta', 20), pago('efectivo', 50)], total: 100 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.electronico, 50)
  assert.equal(r.efectivoAplicado, 50)
  assert.equal(r.pagos.length, 3)
  assert.equal(tipoPagoDe(r.pagos), 'mixto')
})

test('los electrónicos NO pueden superar el total', () => {
  const r = resumenPagos({ pagos: [pago('yape', 100)], total: 80 })
  assert.equal(r.puedeCobrar, false)
  assert.equal(r.excedeElectronico, 20)
  assert.match(r.motivo ?? '', /superan el total/i)
})

test('si falta plata no se puede cobrar y lo dice', () => {
  const r = resumenPagos({ pagos: [pago('efectivo', 50)], total: 100 })
  assert.equal(r.puedeCobrar, false)
  assert.equal(r.falta, 50)
  assert.match(r.motivo ?? '', /Faltan S\/ 50\.00/)
})

test('sin pagos cargados no se puede cobrar', () => {
  const r = resumenPagos({ pagos: [], total: 100 })
  assert.equal(r.puedeCobrar, false)
  assert.equal(r.falta, 100)
  assert.deepEqual(r.pagos, [])
})

test('efectivo de más con parte electrónica: el vuelto sale del efectivo y el aplicado es el resto', () => {
  // El cliente entrega 50 en efectivo y paga 60 por Yape una venta de 100.
  const r = resumenPagos({ pagos: [pago('efectivo', 50), pago('yape', 60)], total: 100 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.electronico, 60)
  assert.equal(r.efectivoAplicado, 40)
  assert.equal(r.vuelto, 10)
  // Lo guardado suma exactamente el total: no hay plata inventada ni perdida.
  assert.equal(r.pagos.reduce((s, p) => s + p.monto, 0), 100)
})

test('lo guardado siempre suma el total cuando es cobrable', () => {
  const casos: PagoEntrada[][] = [
    [pago('efectivo', 80)],
    [pago('yape', 80)],
    [pago('efectivo', 100)],
    [pago('plin', 30), pago('tarjeta', 20), pago('efectivo', 50)],
    [pago('yape', 60), pago('efectivo', 40)],
  ]
  for (const pagos of casos) {
    const r = resumenPagos({ pagos, total: 80 })
    assert.equal(r.puedeCobrar, true, `debería ser cobrable: ${JSON.stringify(pagos)}`)
    assert.equal(r.pagos.reduce((s, p) => s + p.monto, 0), 80, `debería sumar 80: ${JSON.stringify(pagos)}`)
  }
})

test('un pago electrónico solo no inventa un cobro en efectivo', () => {
  const r = resumenPagos({ pagos: [pago('yape', 50)], total: 80 })
  assert.equal(r.puedeCobrar, false)
  assert.equal(r.pagos.length, 1, 'no agrega una pata de efectivo que nadie pagó')
  assert.equal(r.pagos[0].tipo, 'transferencia')
})

test('montos basura (vacío, NaN, negativo, coma) se tratan como 0', () => {
  assert.equal(normalizarMonto(''), 0)
  assert.equal(normalizarMonto('abc'), 0)
  assert.equal(normalizarMonto(-5), 0)
  assert.equal(normalizarMonto(Number.NaN), 0)
  assert.equal(normalizarMonto('12,50'), 12.5)
  assert.equal(normalizarMonto('0.1'), 0.1)
  const r = resumenPagos({ pagos: [pago('efectivo', Number.NaN), pago('yape', 100)], total: 100 })
  assert.equal(r.puedeCobrar, true, 'el pago basura no ensucia la cuenta')
  assert.equal(r.efectivoRecibido, 0)
})

test('decimales de punto flotante no generan sobrantes falsos', () => {
  // 0,1 + 0,2 sin redondear daría 0.30000000000000004 → un "vuelto" inexistente.
  const r = resumenPagos({ pagos: [pago('efectivo', 0.1), pago('yape', 0.2)], total: 0.3 })
  assert.equal(r.puedeCobrar, true)
  assert.equal(r.vuelto, 0)
  assert.equal(r.falta, 0)
})

test('el tope sugerido es lo que falta para los electrónicos y ninguno para el efectivo', () => {
  assert.equal(topeSugerido('yape', 30), 30)
  assert.equal(topeSugerido('tarjeta', 30), 30)
  assert.equal(topeSugerido('efectivo', 30), null)
  assert.equal(topeSugerido('yape', -10), 0, 'nunca un tope negativo')
})

test('la etiqueta del pago aguanta documentos viejos (solo con tipo)', () => {
  assert.equal(etiquetaPago({ medio: 'yape' }), '📱 Yape')
  assert.equal(etiquetaPago({ medio: 'tarjeta' }), '💳 Tarjeta')
  assert.equal(etiquetaPago({ tipo: 'transferencia' }), '📲 Transferencia')
  assert.equal(etiquetaPago({ tipo: 'credito' }), '💳 Crédito')
  assert.equal(etiquetaPago({ tipo: 'mixto' }), '🪙 Mixto')
  assert.equal(etiquetaPago({}), '💵 Efectivo')
})

test('la forma de pago del documento se resume bien', () => {
  assert.equal(formaPagoLabel([], 'credito'), 'Crédito')
  assert.equal(formaPagoLabel([pago('efectivo', 10)], 'efectivo'), 'Efectivo')
  assert.equal(formaPagoLabel([pago('yape', 10)], 'transferencia'), 'Yape')
  assert.equal(formaPagoLabel([pago('yape', 10), pago('efectivo', 10)], 'mixto'), 'Mixto')
  assert.equal(formaPagoLabel([], undefined), 'Efectivo')
})

test('el crédito nunca se guarda como pago mezclado con otros', () => {
  // `tipoPagoDe` sólo ve bolsillos de contado: el crédito se maneja por separado.
  assert.equal(tipoPagoDe([]), 'efectivo')
  assert.equal(tipoPagoDe([{ tipo: 'transferencia', medio: 'yape', monto: 10 }]), 'transferencia')
})
