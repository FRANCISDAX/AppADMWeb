/**
 * Tests del reparto de pedidos por caja (`lib/pedidos.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 *
 * Casos reales que originan estas reglas (17/09/2026): el pedido `PED-000001` quedó invisible
 * porque el vendedor tenía `caja_principal` y el cajero **ninguna**; y con dos cajas, si una se
 * cae con pedidos abiertos, esos pedidos tienen que poder verse y cobrarse desde la otra.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { avisoOtraCaja, nombreCaja, repartirPedidos } from './pedidos.ts'

const p = (id: string, cajaId?: string) => ({ id, cajaId })

describe('repartirPedidos — usuario SIN caja asignada', () => {
  it('ve todos los pedidos (no se esconde ninguno)', () => {
    const r = repartirPedidos([p('a', 'caja_01'), p('b', 'caja_02'), p('c', '')], undefined)
    assert.equal(r.mios.length, 3)
    assert.deepEqual(r.otrasCajas, [])
  })

  it('sin lista no rompe', () => {
    assert.deepEqual(repartirPedidos(null, undefined), { mios: [], otrasCajas: [] })
    assert.deepEqual(repartirPedidos([], 'caja_01'), { mios: [], otrasCajas: [] })
  })
})

describe('repartirPedidos — usuario CON caja', () => {
  it('ve los de su caja y los que no tienen caja', () => {
    const r = repartirPedidos([p('a', 'caja_01'), p('b', ''), p('c', undefined), p('d', 'caja_02')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['a', 'b', 'c'])
    assert.deepEqual(r.otrasCajas.map((x) => x.id), ['d'])
  })

  it('los de otra caja NO desaparecen: se separan para poder rescatarlos', () => {
    const r = repartirPedidos([p('a', 'caja_02'), p('b', 'caja_02')], 'caja_01')
    assert.deepEqual(r.mios, [])
    assert.equal(r.otrasCajas.length, 2)
  })

  it('⚠️ regresión: un pedido de un vendedor SIN caja lo ve el cajero que SÍ tiene caja', () => {
    // Era el segundo agujero: el pedido nacía con cajaId '' y el cajero con caja no lo veía.
    const r = repartirPedidos([p('PED-000001', '')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['PED-000001'])
  })

  it('los espacios no cambian la caja', () => {
    const r = repartirPedidos([p('a', ' caja_01 ')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['a'])
  })
})

describe('nombreCaja / avisoOtraCaja', () => {
  it('el nombre se lee sin guiones bajos', () => {
    assert.equal(nombreCaja('caja_02'), 'caja 02')
    assert.equal(nombreCaja(''), 'sin caja')
  })

  it('el aviso dice de qué caja es y con qué serie se emite', () => {
    const aviso = avisoOtraCaja('caja_02', 'caja_01')
    assert.match(aviso, /caja 02/)
    assert.match(aviso, /caja 01/)
    assert.match(aviso, /serie de tu/)
  })
})
