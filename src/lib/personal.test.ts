/**
 * Tests de los nombres que van impresos en los documentos (`lib/personal.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 *
 * De dónde salen los casos: el flujo de **pedidos** (el vendedor manda la venta a caja y el
 * cajero la cobra) hizo que una venta tenga **dos personas**. Al mismo tiempo, una venta
 * directa guarda el mismo nombre en `cajero` y en `vendedorNombre`, así que "mostrar los dos
 * campos" habría impreso el mismo nombre dos veces.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { lineasPersonal, mismoNombre, personalDeVenta, textoPersonal } from './personal.ts'

describe('personalDeVenta — una sola persona (cajero que vende y cobra)', () => {
  it('no repite el nombre: queda solo el cajero', () => {
    // Es lo que escribe `registrarVenta`: el mismo usuario en los dos campos.
    const p = personalDeVenta({ cajero: 'Juana Pérez', vendedorNombre: 'Juana Pérez' })
    assert.equal(p.vendedor, '')
    assert.equal(p.cajero, 'Juana Pérez')
  })

  it('el mismo nombre con otra caja o espacios también es la misma persona', () => {
    assert.equal(personalDeVenta({ cajero: 'juana pérez', vendedorNombre: ' Juana Pérez ' }).vendedor, '')
    assert.ok(mismoNombre('JUANA PEREZ', 'juana perez'))
  })

  it('un nombre parecido pero distinto SÍ es otra persona', () => {
    const p = personalDeVenta({ cajero: 'Juana Pérez', vendedorNombre: 'Juana Peres' })
    assert.equal(p.vendedor, 'Juana Peres')
    assert.equal(p.cajero, 'Juana Pérez')
  })
})

describe('personalDeVenta — vendedor + cajero (pedido cobrado en caja)', () => {
  it('devuelve los dos', () => {
    const p = personalDeVenta({ cajero: 'Luis Cajero', vendedorNombre: 'Ana Vendedora' })
    assert.deepEqual(p, { vendedor: 'Ana Vendedora', cajero: 'Luis Cajero' })
  })

  it('⚠️ el cajero sale del campo `cajero`, NO de `venta.cajero` (que en un pedido es el vendedor)', () => {
    // Así queda un pedido cobrado: el vendedor escribió `venta.cajero` al mandarlo a caja y el
    // cobro guardó al cajero en el campo `cajero` del documento. Si se leyera al revés, el
    // comprobante diría que el vendedor cobró.
    const p = personalDeVenta({
      cajero: 'Luis Cajero',
      vendedorNombre: 'Ana Vendedora',
      venta: { cajero: 'Ana Vendedora' },
    })
    assert.deepEqual(p, { vendedor: 'Ana Vendedora', cajero: 'Luis Cajero' })
  })

  it('sin vendedor en el documento, `venta.cajero` sirve de cajero (venta directa)', () => {
    const p = personalDeVenta({ venta: { cajero: 'Luis Cajero' } })
    assert.deepEqual(p, { vendedor: '', cajero: 'Luis Cajero' })
  })
})

describe('personalDeVenta — datos incompletos o raros (nunca inventa un nombre)', () => {
  it('sin nada: los dos vacíos', () => {
    assert.deepEqual(personalDeVenta({}), { vendedor: '', cajero: '' })
    assert.deepEqual(personalDeVenta(null), { vendedor: '', cajero: '' })
    assert.deepEqual(personalDeVenta(undefined), { vendedor: '', cajero: '' })
  })

  it('valores que no son texto se ignoran', () => {
    assert.deepEqual(personalDeVenta({ cajero: 42, vendedorNombre: {} } as never), { vendedor: '', cajero: '' })
  })

  it('solo vendedor (documento sin cajero): se muestra el vendedor', () => {
    assert.deepEqual(personalDeVenta({ vendedorNombre: 'Ana' }), { vendedor: 'Ana', cajero: '' })
  })

  it('solo cajero: se muestra el cajero', () => {
    assert.deepEqual(personalDeVenta({ cajero: 'Luis' }), { vendedor: '', cajero: 'Luis' })
  })

  it('`usuarioNombre` es el último recurso para el cajero (items de turno viejos)', () => {
    assert.deepEqual(personalDeVenta({ usuarioNombre: 'Luis' }), { vendedor: '', cajero: 'Luis' })
  })

  it('un solo nombre que coincide con `usuarioNombre` tampoco se duplica', () => {
    const p = personalDeVenta({ usuarioNombre: 'Luis', vendedorNombre: 'Luis' })
    assert.deepEqual(p, { vendedor: '', cajero: 'Luis' })
  })
})

describe('lineasPersonal / textoPersonal', () => {
  it('el vendedor va primero y el cajero después', () => {
    const lineas = lineasPersonal({ vendedor: 'Ana', cajero: 'Luis' })
    assert.deepEqual(lineas, [
      { etiqueta: 'Vendedor', nombre: 'Ana' },
      { etiqueta: 'Cajero', nombre: 'Luis' },
    ])
  })

  it('con una sola persona se imprime una sola línea', () => {
    assert.deepEqual(lineasPersonal({ vendedor: '', cajero: 'Luis' }), [{ etiqueta: 'Cajero', nombre: 'Luis' }])
  })

  it('sin nombres no hay líneas (el PDF no imprime un renglón vacío)', () => {
    assert.deepEqual(lineasPersonal({ vendedor: '', cajero: '' }), [])
    assert.equal(textoPersonal({ vendedor: '', cajero: '' }), '')
  })

  it('el texto armado trae los dos rótulos', () => {
    assert.equal(textoPersonal({ vendedor: 'Ana', cajero: 'Luis' }), 'Vendedor: Ana · Cajero: Luis')
    assert.equal(textoPersonal({ vendedor: '', cajero: 'Luis' }), 'Cajero: Luis')
  })
})
