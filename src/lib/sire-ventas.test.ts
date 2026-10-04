/**
 * **El Registro de Ventas del SIRE** (`lib/sire-ventas.ts`).
 *
 * ⚠️ Lo que estos tests protegen es que **el SIRE declare lo mismo que el comprobante**: es un registro
 * que SUNAT cruza contra los comprobantes electrónicos, así que un descuento sumado en vez de restado
 * (o un IGV recargado encima de un precio que ya lo incluye) es una declaración que no cuadra.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { calcularFilaSire, tipoDocSunat, totalesSire } from './sire-ventas.ts'

const item = (nombre: string, cantidad: number, precioVenta: number, tipoAfectacion = '20') => ({
  id: nombre,
  nombre,
  cantidad,
  precioVenta,
  subtotal: Math.round(cantidad * precioVenta * 100) / 100,
  tipoAfectacion,
})

describe('sire-ventas — lo que declara cada comprobante', () => {
  it('🔑 la boleta 78: con descuento declara lo COBRADO, no la suma de los precios de lista', () => {
    // 📌 Medido en producción el 04/10/2026: `2026-10_BOLETA-B001-000078`, **aceptada por SUNAT**,
    // consolidada de dos pedidos. Los ítems son 6 huevos con promo: precio de lista S/ 3.60 + 3.00 + 5.00
    // = 11.60, descuento S/ 0.60 y **total cobrado S/ 11.00** (el XML aceptado dice `PayableAmount 11.00`).
    // El registro decía **11.60**: sumaba el descuento en vez de restarlo.
    const fila = calcularFilaSire({
      tipoDoc: 'BOLETA',
      venta: {
        total: 11,
        descuentoTotal: 0.6,
        items: [item('HUEVOS', 6, 0.6), item('Coca Cola Personal 500ML', 1, 3), item('Coca Cola 1LT', 1, 5)],
      },
    })

    assert.equal(fila.baseExonerada, 11, 'la base exonerada es lo cobrado')
    assert.equal(fila.igv, 0, 'un ítem exonerado no lleva IGV')
    assert.equal(fila.total, 11, 'el total declarado es S/ 11.00')
    assert.notEqual(fila.total, 11.6, 'NO puede declarar la suma de los precios de lista')
  })

  it('🔑 el descuento se reparte entre las líneas: el total es exactamente lo cobrado', () => {
    const fila = calcularFilaSire({
      tipoDoc: 'BOLETA',
      venta: { total: 2, descuentoTotal: 0.2, items: [item('HUEVOS', 2, 0.6), item('GALLETAS', 2, 0.5)] },
    })
    // 1.20 + 1.00 = 2.20 con 0.20 de descuento ⇒ 2.00
    assert.equal(fila.total, 2)
    assert.equal(fila.baseExonerada, 2)
  })

  it('⚠️ el descuento guardado en snake_case (documentos viejos) también se resta', () => {
    const fila = calcularFilaSire({
      tipoDoc: 'BOLETA',
      venta: { total: 10, descuento_total: 1.2, items: [item('HUEVOS', 12, 0.6), item('AQUA MIA 625ML', 2, 1), item('Inka Cola Pirañita 237ML', 2, 1)] },
    })
    assert.equal(fila.total, 10, '11.20 − 1.20')
  })

  it('🔑 en un ítem GRAVADO la base es el precio sin IGV y el IGV se SEPARA', () => {
    const fila = calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 11.8, items: [item('GRAVADO', 1, 11.8, '10')] } })
    assert.equal(fila.baseGravada, 10, '11.80 ÷ 1.18')
    assert.equal(fila.igv, 1.8)
    assert.equal(fila.total, 11.8, 'el total sigue siendo el precio final al público')
    // ⚠️ El bug viejo hacía `base = 11.80` y `igv = base × 18%` ⇒ declaraba **13.92**.
    assert.notEqual(fila.total, 13.92)
  })

  it('🔑 un descuento en un ítem gravado no toca al exonerado', () => {
    const fila = calcularFilaSire({
      tipoDoc: 'BOLETA',
      venta: { total: 12.8, descuentoTotal: 1.8, items: [item('GRAVADO', 1, 11.8, '10'), item('EXONERADO', 1, 2.8, '20')] },
    })
    // El descuento se reparte **proporcional al importe**: 11.80 y 2.80 sobre 14.60 ⇒ 1.45 y 0.35.
    // Quedan 10.35 (gravado) y 2.45 (exonerado); el gravado se abre en 8.77 + 1.58 de IGV.
    assert.equal(fila.total, 12.8)
    assert.equal(fila.baseExonerada, 2.45, 'el exonerado no se lleva el IGV del otro')
    assert.equal(fila.baseGravada, 8.77)
    assert.equal(fila.igv, 1.58)
    assert.equal(Math.round((fila.baseGravada + fila.igv) * 100) / 100, 10.35, 'el gravado conserva sus 10.35')
  })

  it('🔑 la nota de crédito RESTA (signo negativo en todas las partes)', () => {
    const fila = calcularFilaSire({ tipoDoc: 'NC', venta: { total: 13, items: [item('CERVEZA CRISTAL 650ML', 2, 6.5)] } })
    assert.equal(fila.signo, -1)
    assert.equal(fila.baseExonerada, -13)
    assert.equal(fila.total, -13)
    assert.equal(fila.tipoDocSunat, '07')
  })

  it('la nota de débito suma', () => {
    const fila = calcularFilaSire({ tipoDoc: 'ND', venta: { total: 5, items: [item('FLETE', 1, 5)] } })
    assert.equal(fila.signo, 1)
    assert.equal(fila.total, 5)
    assert.equal(fila.tipoDocSunat, '08')
  })

  it('⚠️ un documento sin ítems declara su total y NO inventa IGV', () => {
    const fila = calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 7.5 } })
    assert.equal(fila.sinDetalle, true)
    assert.equal(fila.total, 7.5)
    assert.equal(fila.igv, 0, 'sin detalle no se supone gravado: suponerlo declararía un IGV que nadie cobró')
    assert.equal(fila.baseGravada, 0)
    assert.equal(fila.baseExonerada, 7.5)
  })

  it('no se rompe con un documento vacío ni con un ítem en cero', () => {
    assert.equal(calcularFilaSire(null).total, 0)
    assert.equal(calcularFilaSire({ tipoDoc: 'BOLETA' }).total, 0)
    const fila = calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 0, items: [item('REGALO', 1, 0)] } })
    assert.equal(fila.total, 0)
  })

  it('el tipo de comprobante sale de la Tabla 11 del RVIE', () => {
    assert.equal(tipoDocSunat('FACTURA'), '01')
    assert.equal(tipoDocSunat('BOLETA'), '03')
    assert.equal(tipoDocSunat('NC'), '07')
    assert.equal(tipoDocSunat('ND'), '08')
    assert.equal(tipoDocSunat(undefined), '03')
  })
})

describe('sire-ventas — los totales del período', () => {
  it('suma las partes y cuenta los documentos', () => {
    const filas = [
      calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 11, descuentoTotal: 0.6, items: [item('HUEVOS', 6, 0.6), item('Coca Cola Personal 500ML', 1, 3), item('Coca Cola 1LT', 1, 5)] } }),
      calcularFilaSire({ tipoDoc: 'NC', venta: { total: 13, items: [item('CERVEZA CRISTAL 650ML', 2, 6.5)] } }),
    ]
    const t = totalesSire(filas)
    assert.equal(t.cantidad, 2)
    assert.equal(t.baseExonerada, -2, '11.00 − 13.00')
    assert.equal(t.total, -2)
    assert.equal(t.sinDetalle, 0)
  })

  it('el total del período es la suma de las partes (nunca se contradicen)', () => {
    const t = totalesSire([
      calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 11.8, items: [item('GRAVADO', 1, 11.8, '10')] } }),
      calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 2.5, items: [item('EXONERADO', 1, 2.5, '20')] } }),
    ])
    assert.equal(t.total, Math.round((t.baseGravada + t.baseExonerada + t.baseInafecta + t.igv) * 100) / 100)
    assert.equal(t.total, 14.3)
  })

  it('avisa cuántos documentos entraron sin detalle', () => {
    const t = totalesSire([calcularFilaSire({ tipoDoc: 'BOLETA', venta: { total: 5 } }), calcularFilaSire({ tipoDoc: 'BOLETA' })])
    assert.equal(t.sinDetalle, 2, 'los dos van sin ítems')
    assert.equal(t.cantidad, 2)
    assert.equal(t.total, 5, 'el que no tiene ni total suma 0')
  })

  it('una lista vacía no rompe nada', () => {
    const t = totalesSire([])
    assert.deepEqual(t, { baseGravada: 0, baseExonerada: 0, baseInafecta: 0, igv: 0, total: 0, cantidad: 0, sinDetalle: 0 })
  })
})

/**
 * 🛡️ **Test-guarda**: la cuenta del SIRE no puede volver a escribirse por su cuenta. El bug del
 * 04/10/2026 nació de tener la aritmética **dentro de la pantalla** (sumaba `items[].subtotal` a mano y
 * usaba `0.18` escrito ahí). Estas dos comprobaciones fallan si alguien la duplica.
 */
describe('🛡️ la cuenta del SIRE es una sola', () => {
  const modulo = readFileSync(new URL('./sire-ventas.ts', import.meta.url), 'utf8')
  const pantalla = readFileSync(new URL('../pages/ReporteSire.tsx', import.meta.url), 'utf8')

  it('el módulo usa la regla del comprobante y no tiene su propia aritmética', () => {
    assert.match(modulo, /itemsParaSunat\(/, 'tiene que usar la misma regla que el XML')
    assert.match(modulo, /descuentoDeVenta\(/, 'el descuento sale de la regla única')
    assert.match(modulo, /precioSinIgv\(/, 'el IGV de un gravado se separa con la regla de precio-venta')
    assert.match(modulo, /afectacionGuardada\(/, 'la afectación de un documento guardado tiene su regla')
    assert.match(modulo, /signoDoc\(/, 'el signo de la NC tiene su regla')
    assert.ok(!/0\.18/.test(modulo), 'la tasa de IGV no se escribe a mano')
    assert.ok(!/it\.subtotal/.test(modulo), 'no se suma el subtotal a mano: eso es el precio de lista')
  })

  it('la pantalla usa el módulo y ya no calcula los importes por su cuenta', () => {
    assert.match(pantalla, /from '@\/lib\/sire-ventas'/, 'la pantalla importa la regla')
    assert.match(pantalla, /calcularFilaSire\(/, 'y la usa para cada documento')
    assert.match(pantalla, /totalesSire\(/, 'y para los totales')
    assert.ok(!/it\.subtotal/.test(pantalla), 'el cálculo viejo (sumar `items[].subtotal`) no puede volver')
    assert.ok(!/0\.18/.test(pantalla), 'ni la tasa de IGV escrita a mano')
    assert.ok(!/baseGravada \* 0\.18/.test(pantalla), 'ni el IGV recargado encima del precio')
  })
})
