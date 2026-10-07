/**
 * **La tasa del IGV configurable** (`lib/igv.ts`).
 *
 * ⚠️ Lo que estos tests protegen: que un porcentaje mal cargado **no** declare mal un comprobante, y que
 * la tasa de un documento **ya emitido** no dependa de la configuración actual (una factura al 18% tiene
 * que seguir diciendo 18% aunque el negocio pase al 10%).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  IGV_PORCENTAJE_DEFECTO,
  IGV_PORCENTAJE_MAX,
  IGV_TASA_DEFECTO,
  etiquetaIgv,
  porcentajeDeTasa,
  porcentajeDelDocumento,
  porcentajeTexto,
  porcentajeValido,
  tasaDePorcentaje,
  tasaDelDocumento,
} from './igv.ts'
import { datosComprobanteA4 } from './comprobante-a4.ts'
import { construirPayloadComprobante } from './sunat.ts'

describe('igv — la tasa de fábrica', () => {
  it('es el 18% del Perú', () => {
    assert.equal(IGV_PORCENTAJE_DEFECTO, 18)
    assert.equal(IGV_TASA_DEFECTO, 0.18)
  })

  it('sin dato en ningún lado, un documento se declara al 18%', () => {
    assert.equal(porcentajeDelDocumento({}, {}), 18)
    assert.equal(porcentajeDelDocumento(null, null), 18)
    assert.equal(tasaDelDocumento(undefined, undefined), 0.18)
  })
})

describe('igv — la tasa de un restaurante/hotel (10%)', () => {
  it('el 10% se convierte en factor y vuelve', () => {
    assert.equal(tasaDePorcentaje(10), 0.1)
    assert.equal(porcentajeDeTasa(0.1), 10)
  })

  it('un documento del 10% despeja un décimo, no un 18%', () => {
    // El precio es final: 11.00 con 10% ⇒ base 10.00 + IGV 1.00 (con 18% daría 9.32 + 1.68).
    const tasa = tasaDelDocumento({ igvPorcentaje: 10 })
    const base = Number((11 / (1 + tasa)).toFixed(2))
    assert.equal(base, 10)
    assert.equal(Number((11 - base).toFixed(2)), 1)
  })

  it('🔑 la tasa GUARDADA en la venta manda sobre la configuración de hoy', () => {
    // La empresa pasó al 10% pero la factura se emitió al 18%: tiene que seguir diciendo 18%.
    const venta = { igvPorcentaje: 18 }
    assert.equal(porcentajeDelDocumento(venta, { igvPorcentaje: 10 }), 18)
    assert.equal(tasaDelDocumento(venta, { igvPorcentaje: 10 }), 0.18)
  })

  it('una venta sin tasa guardada (o de la app móvil) usa la configuración', () => {
    assert.equal(porcentajeDelDocumento({}, { igvPorcentaje: 10 }), 10)
    assert.equal(porcentajeDelDocumento({ igvPorcentaje: 0 }, { igvPorcentaje: 10 }), 10, 'un 0 guardado no es una tasa')
    assert.equal(porcentajeDelDocumento({ igvPorcentaje: null }, { igvPorcentaje: 10 }), 10)
  })
})

describe('igv — un porcentaje mal cargado no puede romper nada', () => {
  it('vacío, texto, NaN, 0 y negativos caen al 18%', () => {
    for (const malo of ['', null, undefined, 'abc', NaN, 0, -5]) {
      assert.equal(porcentajeValido(malo), 18, `${String(malo)} debería caer al 18%`)
    }
  })

  it('un dedazo por encima del tope tampoco se acepta', () => {
    assert.equal(porcentajeValido(IGV_PORCENTAJE_MAX + 1), 18)
    assert.equal(porcentajeValido(180), 18)
    assert.equal(porcentajeValido(IGV_PORCENTAJE_MAX), 30, 'el tope mismo sí es válido')
  })

  it('acepta decimales y los deja con dos dígitos', () => {
    assert.equal(porcentajeValido(10), 10)
    assert.equal(porcentajeValido('10'), 10, 'el campo del formulario llega como texto')
    assert.equal(porcentajeValido(18.5), 18.5)
    assert.equal(porcentajeValido(10.129), 10.13)
  })
})

describe('igv — el título del comprobante', () => {
  it('🔑 dice la tasa, que es lo que pidió el usuario', () => {
    assert.equal(etiquetaIgv(18), 'I.G.V. (18%)')
    assert.equal(etiquetaIgv(10), 'I.G.V. (10%)')
  })

  it('sin decimales de más y con el respaldo del 18%', () => {
    assert.equal(etiquetaIgv(18.0), 'I.G.V. (18%)')
    assert.equal(etiquetaIgv(18.5), 'I.G.V. (18.5%)')
    assert.equal(etiquetaIgv(0), 'I.G.V. (18%)', 'un 0 no puede salir impreso como tasa')
    assert.equal(porcentajeTexto(10), '10')
  })
})

/** El negocio de un restaurante/hotel: la tasa de venta es el 10%. */
const CONFIG_10 = { nombre: 'RESTAURANTE', ruc: '20600000000', direccion: 'Calle 1', regionExonerada: false, igvPorcentaje: 10, serieBoleta: 'B001', serieFactura: 'F001' }

/** Una boleta de un menú de S/ 11.00, con la tasa que se le pase guardada en la venta. */
const boletaDe = (igvPorcentaje?: number) => ({
  tipoDoc: 'BOLETA',
  serie: 'B001',
  numero: 1,
  serieNumero: 'B001-000001',
  correlativo: 1,
  sunat: { serie: 'B001', numero: 1 },
  venta: {
    id: 'V-1',
    fecha: '2026-10-07T12:00:00.000Z',
    items: [{ id: 'p1', nombre: 'MENÚ DEL DÍA', cantidad: 1, precioVenta: 11, subtotal: 11, unidad: 'NIU', tipoAfectacion: '10' }],
    total: 11,
    importe_total: 11,
    tipoPago: 'efectivo',
    montoRecibido: 11,
    cambio: 0,
    cliente_nombre: 'CLIENTE',
    cliente_dni: '12345678',
    ...(igvPorcentaje === undefined ? {} : { igvPorcentaje }),
  },
})

describe('igv — la MISMA tasa en todos los papeles', () => {
  it('🔑 el comprobante de un restaurante (10%) separa un décimo, no un 18%', () => {
    const m = datosComprobanteA4({ doc: boletaDe(), correlativo: 1, config: CONFIG_10, tipoDoc: 'BOLETA', sunat: { serie: 'B001', numero: 1 } })
    assert.equal(m.totales.igvPorcentaje, 10)
    assert.equal(m.totales.opGravadas, 10)
    assert.equal(m.totales.igv, 1)
    assert.equal(m.totales.total, 11)
  })

  it('🔑 un comprobante YA EMITIDO al 18% sigue diciendo 18%', () => {
    const m = datosComprobanteA4({ doc: boletaDe(18), correlativo: 1, config: CONFIG_10, tipoDoc: 'BOLETA', sunat: { serie: 'B001', numero: 1 } })
    assert.equal(m.totales.igvPorcentaje, 18, 'la tasa guardada manda sobre la configuración de hoy')
    assert.equal(m.totales.opGravadas, 9.32)
    assert.equal(m.totales.igv, 1.68)
    assert.equal(m.totales.total, 11, 'y el total sigue siendo lo cobrado')
  })

  it('🔑 lo que se manda a SUNAT lleva la tasa del documento', () => {
    const p = construirPayloadComprobante(boletaDe(), CONFIG_10)
    assert.equal(p.tasa_igv, 0.1, 'sin `tasa_igv` el backend declararía 18%')
    assert.equal(p.items[0].precio_unitario, 10, 'la base sin IGV va despejada con la tasa del 10%')
    assert.equal(p.totales.igv, 1)
    assert.equal(p.totales.total, 11)
  })

  it('el payload de una venta vieja (sin tasa guardada) usa la configuración', () => {
    const p = construirPayloadComprobante(boletaDe(18), CONFIG_10)
    assert.equal(p.tasa_igv, 0.18, 'la tasa del documento, no la del negocio')
    assert.equal(p.items[0].precio_unitario, 9.32)
  })
})

/**
 * 🛡️ **Test-guardas**: la tasa tiene que salir de **una sola regla**. El bug que esto evita es el que ya
 * pasó con el 18% escrito a mano en cinco lugares: que el papel diga una tasa y el XML declare otra.
 */
describe('🛡️ la tasa no se escribe a mano en ningún lado', () => {
  const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('los dos PDF sacan el título de la regla (no un «I.G.V.» pelado)', () => {
    for (const f of ['./pdf.ts', './comprobante-a4.ts']) {
      const src = leer(f)
      assert.match(src, /etiquetaIgv\(/, `${f} tiene que usar etiquetaIgv()`)
      assert.ok(!/'I\.G\.V\.'/.test(src), `${f} no puede volver a escribir 'I.G.V.' a mano`)
    }
  })

  it('el que arma el envío a SUNAT usa la tasa del documento', () => {
    const src = leer('./sunat.ts')
    assert.match(src, /tasaDelDocumento\(/)
    assert.match(src, /tasa_igv: tasaIgv/, 'la tasa tiene que viajar en el payload')
    assert.ok(!/\* 0\.18/.test(src), 'sunat.ts no puede multiplicar por 0.18 a mano')
  })

  it('el cálculo del comprobante no tiene su propio 18%', () => {
    const src = leer('./comprobante-comun.ts')
    assert.ok(!/0\.18/.test(src), 'la tasa tiene que venir por parámetro')
    assert.match(src, /obtenerInfoAfectacion\(codigo: string, tasaGravado/)
  })

  it('el SIRE recibe la misma tasa que el comprobante', () => {
    const src = leer('../pages/ReporteSire.tsx')
    assert.match(src, /calcularFilaSire\(d, config\)/)
  })

  it('la configuración trae el campo con el 18% de fábrica', () => {
    const src = leer('../constants/tributario.ts')
    assert.match(src, /igvPorcentaje: 18/)
  })

  it('⚠️ la compra NO sigue la tasa de venta (el IGV del proveedor es el del papel)', () => {
    const src = leer('./precio-venta.ts')
    assert.match(src, /costoDeCompra/, 'sigue existiendo la regla del costo')
    assert.ok(
      !/costoDeCompra[\s\S]{0,600}?tasaDelDocumento/.test(src),
      'el costo de compra no puede usar la tasa de venta: el IGV del proveedor es otro',
    )
  })

  /**
   * 🔑 **La tasa se guarda CON el documento**: si no, el día que el negocio cambie de régimen (o alguien
   * corrija el campo) todos los comprobantes ya emitidos se reimprimirían con la tasa nueva — una factura
   * declarada al 18% saldría diciendo 10%. Estos guardas fallan si un camino de emisión deja de guardarla.
   */
  it('los cuatro caminos que emiten comprobante guardan la tasa con la venta', () => {
    const caminos: [string, RegExp][] = [
      ['../services/ventas.ts', /igvPorcentaje: porcentajeValido\(config\.igvPorcentaje\)/],
      ['../services/ventas.ts', /igvPorcentaje: porcentajeValido\(config\?\.igvPorcentaje\)/],
      ['../services/consolidado.ts', /igvPorcentaje: porcentajeValido\(config\.igvPorcentaje\)/],
      ['../services/notas.ts', /igvPorcentaje: porcentajeDelDocumento\(ventaOriginal, config\)/],
    ]
    for (const [archivo, patron] of caminos) {
      assert.match(leer(archivo), patron, `${archivo} tiene que guardar la tasa del documento`)
    }
  })

  it('el campo de Empresa se guarda siempre válido', () => {
    const src = leer('../hooks/use-configuracion.ts')
    assert.match(src, /igvPorcentaje: porcentajeValido\(config\.igvPorcentaje\)/)
  })
})
