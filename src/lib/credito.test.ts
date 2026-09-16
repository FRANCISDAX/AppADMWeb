import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { disponibleDe, evaluarVentaCredito, redondear2, type EstadoCredito } from './credito.ts'

const cliente = (parcial: Partial<EstadoCredito> = {}): EstadoCredito => ({
  existe: true,
  activo: true,
  limite: 0,
  saldo: 0,
  ...parcial,
})

test('sin límite configurado (0) siempre permite y no calcula disponible', () => {
  const r = evaluarVentaCredito({ total: 500, estado: cliente({ limite: 0, saldo: 300 }) })
  assert.equal(r.permitido, true)
  assert.equal(r.disponible, Infinity)
  assert.equal(r.saldoDespues, 800)
  assert.equal(disponibleDe(cliente({ limite: 0 })), Infinity)
})

test('cliente no registrado: no permite y explica qué hacer', () => {
  const r = evaluarVentaCredito({ total: 10, estado: cliente({ existe: false }) })
  assert.equal(r.permitido, false)
  assert.match(r.motivo ?? '', /no está registrado/i)
})

test('cliente con crédito desactivado: no permite', () => {
  const r = evaluarVentaCredito({ total: 10, estado: cliente({ activo: false }) })
  assert.equal(r.permitido, false)
  assert.match(r.motivo ?? '', /no tiene crédito activo/i)
})

test('dentro del límite: permite y muestra el saldo resultante', () => {
  const estado = cliente({ limite: 100, saldo: 30 })
  const r = evaluarVentaCredito({ total: 50, estado })
  assert.equal(r.permitido, true)
  assert.equal(r.saldoDespues, 80)
  assert.equal(r.disponible, 70)
  assert.equal(r.excedente, 0)
})

test('justo en el límite: permite (no bloquea por el borde)', () => {
  const r = evaluarVentaCredito({ total: 20, estado: cliente({ limite: 100, saldo: 80 }) })
  assert.equal(r.permitido, true)
  assert.equal(r.saldoDespues, 100)
  assert.equal(r.disponible, 20)
})

test('se pasa del límite: bloquea, calcula el excedente y lo explica', () => {
  const r = evaluarVentaCredito({ total: 30, estado: cliente({ limite: 100, saldo: 80 }) })
  assert.equal(r.permitido, false)
  assert.equal(r.excedente, 10)
  assert.equal(r.saldoDespues, 110)
  assert.match(r.motivo ?? '', /límite de crédito/i)
  assert.match(r.motivo ?? '', /110\.00/)
  assert.match(r.motivo ?? '', /10\.00/)
})

test('tolera céntimos de redondeo (0,005 no bloquea)', () => {
  const r = evaluarVentaCredito({ total: 20.005, estado: cliente({ limite: 100, saldo: 80 }) })
  assert.equal(r.permitido, true)
})

test('sumas con decimales no generan excedentes falsos (0,1 + 0,2)', () => {
  const r = evaluarVentaCredito({ total: 0.2, estado: cliente({ limite: 0.3, saldo: 0.1 }) })
  assert.equal(r.permitido, true)
  assert.equal(r.saldoDespues, 0.3)
})

test('si ya debe más que el límite, el disponible no queda negativo', () => {
  const estado = cliente({ limite: 50, saldo: 70 })
  assert.equal(disponibleDe(estado), 0)
  const r = evaluarVentaCredito({ total: 1, estado })
  assert.equal(r.permitido, false)
  assert.equal(r.disponible, 0)
})

test('total inválido o negativo se trata como 0', () => {
  const r = evaluarVentaCredito({ total: Number.NaN, estado: cliente({ limite: 100, saldo: 100 }) })
  assert.equal(r.permitido, true)
  assert.equal(r.saldoDespues, 100)
})

test('redondear2 evita la basura de punto flotante', () => {
  assert.equal(redondear2(0.1 + 0.2), 0.3)
  assert.equal(redondear2(1.005), 1.01)
  assert.equal(redondear2(Number.NaN), 0)
})
