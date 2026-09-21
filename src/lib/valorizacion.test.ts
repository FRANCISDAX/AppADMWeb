/**
 * Tests de la valorización con costo promedio ponderado móvil (`lib/valorizacion.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  costoVigente,
  promedioConEntrada,
  redondearCosto,
  resumenValorizacion,
  valorDeSalida,
  valorDeStock,
  valorizarMovimiento,
} from './valorizacion.ts'

describe('promedioConEntrada', () => {
  it('sin stock previo, el promedio es el costo de la entrada', () => {
    assert.equal(promedioConEntrada({ stockActual: 0, promedioActual: 0, cantidad: 10, costoEntrada: 2.5 }), 2.5)
  })

  it('pondera el stock previo con el que entra', () => {
    // 10 unidades a 2.00 (S/ 20) + 10 unidades a 3.00 (S/ 30) = 20 unidades por S/ 50 → 2.50
    assert.equal(promedioConEntrada({ stockActual: 10, promedioActual: 2, cantidad: 10, costoEntrada: 3 }), 2.5)
    // 30 a 2.00 (60) + 10 a 4.00 (40) = 40 unidades por S/ 100 → 2.50
    assert.equal(promedioConEntrada({ stockActual: 30, promedioActual: 2, cantidad: 10, costoEntrada: 4 }), 2.5)
  })

  it('⚠️ con stock negativo no divide por un stock sin sentido: manda el costo de la entrada', () => {
    // Si se vendió antes de cargar la compra, promediar con un stock negativo daría un número absurdo.
    assert.equal(promedioConEntrada({ stockActual: -5, promedioActual: 2, cantidad: 10, costoEntrada: 3 }), 3)
  })

  it('una entrada de cantidad cero o negativa no cambia el promedio', () => {
    assert.equal(promedioConEntrada({ stockActual: 10, promedioActual: 2.5, cantidad: 0, costoEntrada: 9 }), 2.5)
    assert.equal(promedioConEntrada({ stockActual: 10, promedioActual: 2.5, cantidad: -3, costoEntrada: 9 }), 2.5)
  })

  it('guarda 4 decimales para no acumular error de redondeo', () => {
    // 3 unidades a 10.00 (30) + 1 a 3.33 (3.33) = 4 unidades por 33.33 → 8.3325 exacto
    assert.equal(promedioConEntrada({ stockActual: 3, promedioActual: 10, cantidad: 1, costoEntrada: 3.33 }), 8.3325)
    // 3 unidades a 1.00 + 1 a 1.11 → 4.11 / 4 = 1.0275
    assert.equal(promedioConEntrada({ stockActual: 3, promedioActual: 1, cantidad: 1, costoEntrada: 1.11 }), 1.0275)
    assert.equal(redondearCosto(1.027549999), 1.0275)
  })
})

describe('costoVigente', () => {
  it('usa el promedio cuando existe y el último costo como respaldo', () => {
    assert.equal(costoVigente({ costoPromedio: 2.5, costoUltimo: 9 }), 2.5)
    assert.equal(costoVigente({ costoPromedio: 0, costoUltimo: 3 }), 3)
    assert.equal(costoVigente({}), 0, 'sin ningún costo no inventa un valor')
  })
})

describe('valorizarMovimiento', () => {
  const base = { cantidad: 10, stockAntes: 10, stockNuevo: 20, costoPromedioActual: 2, costoEntrada: 3, costoUltimo: 2 }

  it('una entrada se valoriza a su costo y actualiza el promedio', () => {
    const v = valorizarMovimiento({ esEntrada: true, ...base })
    assert.equal(v.costoUnitario, 3)
    assert.equal(v.valorTotal, 30)
    assert.equal(v.costoPromedioDespues, 2.5)
    assert.equal(v.stockValorizadoDespues, 50, '20 unidades × 2.50')
  })

  it('⚠️ una salida se valoriza al promedio y NO lo cambia', () => {
    const v = valorizarMovimiento({ esEntrada: false, ...base, cantidad: 5, stockAntes: 20, stockNuevo: 15, costoEntrada: 9 })
    assert.equal(v.costoUnitario, 2, 'la salida no arrastra el precio de la última compra')
    assert.equal(v.valorTotal, 10)
    assert.equal(v.costoPromedioDespues, 2)
    assert.equal(v.stockValorizadoDespues, 30, '15 unidades × 2.00')
  })

  it('sin promedio calculado todavía, usa el último costo (un producto viejo no vale cero)', () => {
    const v = valorizarMovimiento({ esEntrada: false, cantidad: 2, stockAntes: 4, stockNuevo: 2, costoPromedioActual: null, costoUltimo: 1.5 })
    assert.equal(v.costoUnitario, 1.5)
    assert.equal(v.valorTotal, 3)
    assert.equal(v.stockValorizadoDespues, 3)
  })

  it('la primera compra de un producto sin stock fija el promedio en su costo', () => {
    const v = valorizarMovimiento({ esEntrada: true, cantidad: 12, stockAntes: 0, stockNuevo: 12, costoPromedioActual: 0, costoEntrada: 4.25 })
    assert.equal(v.costoPromedioDespues, 4.25)
    assert.equal(v.stockValorizadoDespues, 51)
  })
})

describe('valorDeSalida y valorDeStock', () => {
  it('multiplican y redondean a dos decimales (es plata)', () => {
    assert.equal(valorDeSalida({ cantidad: 3, costoPromedio: 1.0275 }), 3.08)
    assert.equal(valorDeStock({ stock: 3, costo: 1.0275 }), 3.08)
    assert.equal(valorDeStock({ stock: 0, costo: 5 }), 0)
  })
})

describe('resumenValorizacion', () => {
  it('arma las filas, las ordena por valor y suma el total', () => {
    const r = resumenValorizacion([
      { id: 'a', nombre: 'Arroz', categoria: 'ABARROTES', stock: 10, costoPromedio: 2 },
      { id: 'b', nombre: 'Aceite', categoria: 'ABARROTES', stock: 2, costoPromedio: 12 },
      { id: 'c', nombre: 'Sin costo', categoria: 'OTROS', stock: 5, precioCompra: 0 },
    ])
    assert.deepEqual(r.filas.map((f) => f.productoId), ['b', 'a', 'c'], 'ordenado por valor, de mayor a menor')
    assert.equal(r.total, 44, '24 + 20 + 0')
    assert.equal(r.unidades, 17)
    assert.equal(r.filas[0].usaPromedio, true)
    assert.equal(r.filas[2].valor, 0)
  })

  it('marca las filas que todavía usan el último costo como respaldo', () => {
    const r = resumenValorizacion([{ id: 'x', stock: 4, precioCompra: 2.5 }])
    assert.equal(r.filas[0].usaPromedio, false)
    assert.equal(r.filas[0].costoPromedio, 2.5)
    assert.equal(r.filas[0].valor, 10)
  })

  it('aguanta una lista vacía o productos incompletos', () => {
    assert.deepEqual(resumenValorizacion([]), { filas: [], total: 0, unidades: 0 })
    const r = resumenValorizacion([{}, { id: 'z', stock: -3, costoPromedio: 2 }])
    assert.equal(r.filas.length, 2)
    assert.equal(r.total, -6, 'no esconde un stock negativo: el dato raro se ve')
  })
})
