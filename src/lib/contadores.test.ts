/**
 * Tests de las claves de contador (`lib/contadores.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita. Este módulo no
 * importa nada (ni el alias `@/`), que es justamente lo que lo hace testeable: `lib/series.ts`
 * sí importa `@/constants` y por eso **no** se puede cargar con el runner nativo.
 *
 * De dónde salen estos casos: las **ventas pendientes** (16/09/2026) numeraban con
 * `sunat_{serie}` para todo —incluida la Nota de Venta, que numera con `notaVenta_`— y
 * escribían el campo `contador`. Resultado real en producción: nació un contador
 * **`sunat_NV01` que arrancaba en 1** mientras las NV vivas iban por
 * `notaVenta_NV01 = 173` → la siguiente NV pendiente habría salido `NV01-000001`,
 * **repitiendo un número ya emitido**.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CAMPO_CONTADOR, CLAVE_PEDIDO, claveContador, codigoPedido, espacioContador } from './contadores.ts'

describe('claveContador — una nota de venta usa OTRO contador', () => {
  it('la NV numera con notaVenta_{serie}', () => {
    assert.equal(claveContador('NV', 'NV01'), 'notaVenta_NV01')
    assert.equal(claveContador('NV', 'BB02'), 'notaVenta_BB02')
  })

  it('boletas y facturas numeran con sunat_{serie}', () => {
    assert.equal(claveContador('BOLETA', 'B001'), 'sunat_B001')
    assert.equal(claveContador('FACTURA', 'F001'), 'sunat_F001')
  })

  it('las notas de crédito/débito comparten el contador de SUNAT', () => {
    assert.equal(claveContador('NC', 'BC01'), 'sunat_BC01')
    assert.equal(claveContador('ND', 'BD01'), 'sunat_BD01')
  })

  it('⚠️ regresión: la NV NUNCA cae en el contador de sunat', () => {
    assert.notEqual(claveContador('NV', 'NV01'), 'sunat_NV01', 'era el bug de las ventas pendientes')
    assert.notEqual(claveContador('NV', 'NV01'), claveContador('BOLETA', 'NV01'), 'espacios separados')
  })

  it('el espacio es solo dos valores: sunat o notaVenta', () => {
    assert.equal(espacioContador('NV'), 'notaVenta')
    assert.equal(espacioContador('BOLETA'), 'sunat')
    assert.equal(espacioContador('FACTURA'), 'sunat')
    assert.equal(espacioContador('NC'), 'sunat')
    assert.equal(espacioContador('ND'), 'sunat')
  })
})

describe('CAMPO_CONTADOR', () => {
  it('es el campo que lee y escribe TODO el sistema', () => {
    assert.equal(CAMPO_CONTADOR, 'ultimoCorrelativo')
  })

  it('⚠️ regresión: no es el campo que usaba el flujo de ventas pendientes', () => {
    assert.notEqual(CAMPO_CONTADOR, 'contador', 'aquel flujo creaba un contador paralelo que nadie más leía')
  })
})

describe('pedidos (venta enviada a caja, sin comprobante)', () => {
  it('el código es legible y va a 6 dígitos', () => {
    assert.equal(codigoPedido(1), 'PED-000001')
    assert.equal(codigoPedido(123), 'PED-000123')
  })

  it('un valor raro no rompe el código', () => {
    assert.equal(codigoPedido(0), 'PED-000000')
    assert.equal(codigoPedido(-5), 'PED-000000')
    assert.equal(codigoPedido(7.9), 'PED-000007')
  })

  it('⚠️ un pedido NUNCA se confunde con un comprobante numerado', () => {
    // Los comprobantes se arman como `{serie}-{correlativo}`; un pedido lleva su propio prefijo,
    // así que no puede chocar con una serie fiscal aunque se llamen parecido.
    assert.ok(!codigoPedido(1).includes('NV01-'))
    assert.notEqual(codigoPedido(123), `NV01-${String(123).padStart(6, '0')}`)
  })

  it('su contador vive en un espacio propio, fuera de los de comprobantes', () => {
    assert.equal(CLAVE_PEDIDO, 'pedido')
    assert.notEqual(CLAVE_PEDIDO, claveContador('NV', 'NV01'))
    assert.notEqual(CLAVE_PEDIDO, claveContador('BOLETA', 'B001'))
    assert.notEqual(CLAVE_PEDIDO, claveContador('FACTURA', 'F001'))
  })
})
