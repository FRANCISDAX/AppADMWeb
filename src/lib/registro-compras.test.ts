/**
 * Tests del **Registro de Compras (SUNAT · RCE)** — `lib/registro-compras.ts`.
 *
 * 🔑 **Lo que estos tests fijan** (todo sale del *Anexo 8.4* de la RS 040-2022/SUNAT, no de la intuición):
 *
 * - **El CAR son 27 caracteres** (`RUC 11 + tipo 2 + serie 4 + número 10`), con ceros a la izquierda y, si el
 *   serie/número se pasa de largo, los dígitos **de la derecha** (Tabla 7).
 * - **El proveedor pone la base y el IGV, no el catálogo**: una compra con IGV se despeja (`÷ 1,18`) y una sin
 *   IGV va a **no gravadas**, aunque el producto sea gravado o exonerado. Es el caso real de esta región:
 *   se compra en Lima **con** IGV y se vende exonerado.
 * - **DG vs DGNG**: el IGV de una compra es **crédito fiscal** o **no** según lo que el negocio haya dicho en
 *   esa compra (no según la config de hoy), y eso cambia de columna.
 * - **Las notas de crédito van en negativo** (`07`, `87`): restan del registro.
 * - Los totales son la suma de las filas ya redondeadas (el registro tiene que cuadrar consigo mismo).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CABECERA_EXPORT_COMPRAS,
  armarRegistroCompras,
  carSunat,
  comprobanteDeNota,
  esNotaCredito,
  esNotaDebito,
  fechaRegistro,
  filasExportCompras,
  labelTipoComprobante,
  periodoDe,
  signoDeComprobante,
  tipoDocIdentidad,
  type CompraRegistro,
} from './registro-compras.ts'

/** Una compra de una tienda: factura del proveedor por S/ 118 (100 + 18 de IGV). */
function compra(extra: Partial<CompraRegistro> = {}): CompraRegistro {
  return {
    compraId: 'compra_1',
    fecha: '2026-09-20T10:00:00.000Z',
    proveedor: 'DISTRIBUIDORA LIMA SAC',
    proveedorId: '20512345678',
    tipoComprobante: '01',
    serie: 'F001',
    numero: '123',
    items: [{ importe: 118, traeIgv: true, igvConCredito: true }],
    ...extra,
  }
}

describe('CAR SUNAT (Tabla 7 del anexo del RCE)', () => {
  it('son 27 caracteres: RUC 11 + tipo 2 + serie 4 + número 10', () => {
    const car = carSunat({ documento: '20512345678', tipoComprobante: '01', serie: 'F001', numero: '123' })
    assert.equal(car.length, 27)
    assert.equal(car, '20512345678' + '01' + 'F001' + '0000000123')
  })

  it('rellena con ceros a la izquierda el RUC corto (DNI) y el número', () => {
    assert.equal(
      carSunat({ documento: '12345678', tipoComprobante: '03', serie: 'B1', numero: '7' }),
      '00012345678' + '03' + '00B1' + '0000000007',
    )
  })

  it('si el número se pasa de largo toma los dígitos de la DERECHA', () => {
    const car = carSunat({ documento: '20512345678', tipoComprobante: '01', serie: 'F001', numero: '1234567890123' })
    assert.equal(car.slice(-10), '4567890123', 'los 10 últimos dígitos del número')
  })

  it('sin documento del proveedor no inventa un CAR', () => {
    const registro = armarRegistroCompras([compra({ proveedorId: '' })])
    assert.equal(registro.filas[0].car, '')
    assert.deepEqual(registro.avisos[0].falta, ['RUC/DNI del proveedor'])
  })
})

describe('tipo de documento de identidad (Tabla 1)', () => {
  it('RUC = 6, DNI = 1, cualquier otro = 0 (no domiciliado sin RUC)', () => {
    assert.equal(tipoDocIdentidad('20512345678'), '6')
    assert.equal(tipoDocIdentidad('12345678'), '1')
    assert.equal(tipoDocIdentidad(''), '0')
    assert.equal(tipoDocIdentidad('abc'), '0')
  })
})

describe('tipos de comprobante y su signo (Tabla 11 y 12)', () => {
  it('las notas de crédito van en negativo y las de débito en positivo', () => {
    assert.equal(esNotaCredito('07'), true)
    assert.equal(esNotaCredito('87'), true)
    assert.equal(signoDeComprobante('07'), -1)
    assert.equal(signoDeComprobante('87'), -1)
    assert.equal(esNotaDebito('08'), true)
    assert.equal(signoDeComprobante('01'), 1)
  })

  it('el rótulo sale de la tabla y un código raro no rompe', () => {
    assert.equal(labelTipoComprobante('01'), 'Factura')
    assert.equal(labelTipoComprobante('12'), 'Ticket / Ticket POS')
    assert.equal(labelTipoComprobante(''), 'Sin tipo')
    assert.equal(labelTipoComprobante('99'), 'Otros (99)')
  })
})

describe('armarRegistroCompras — una fila por comprobante del proveedor', () => {
  it('una factura con IGV: base 100, IGV 18, total 118 (con crédito fiscal)', () => {
    const r = armarRegistroCompras([compra()], { igvRecuperable: true })
    const f = r.filas[0]
    assert.equal(f.baseConCredito, 100)
    assert.equal(f.igvConCredito, 18)
    assert.equal(f.baseSinCredito, 0)
    assert.equal(f.noGravadas, 0)
    assert.equal(f.total, 118)
    assert.equal(f.tipoDocIdentidad, '6')
    assert.equal(r.totales.igvCreditoFiscal, 18)
    assert.equal(r.avisos.length, 0)
  })

  it('el mismo comprobante SIN derecho a crédito va a las columnas DGNG', () => {
    const r = armarRegistroCompras([compra({ items: [{ importe: 118, traeIgv: true, igvConCredito: false }] })])
    const f = r.filas[0]
    assert.equal(f.baseConCredito, 0)
    assert.equal(f.igvConCredito, 0)
    assert.equal(f.baseSinCredito, 100)
    assert.equal(f.igvSinCredito, 18)
    assert.equal(f.total, 118)
    assert.equal(r.totales.igvCreditoFiscal, 0)
  })

  it('una compra SIN IGV (proveedor exonerado o boleta interna) va a no gravadas', () => {
    const r = armarRegistroCompras([compra({ items: [{ importe: 118, traeIgv: false }] })])
    const f = r.filas[0]
    assert.equal(f.noGravadas, 118)
    assert.equal(f.baseConCredito, 0)
    assert.equal(f.igvConCredito, 0)
    assert.equal(f.total, 118)
  })

  it('📌 el caso de esta región: se compra en Lima CON IGV y el IGV no es crédito', () => {
    // Producto exonerado ('20') comprado con factura de Lima: el IGV existe pero no se recupera (DGNG).
    const r = armarRegistroCompras(
      [compra({ items: [{ importe: 118, traeIgv: true, igvConCredito: false }] })],
      { igvRecuperable: false },
    )
    const f = r.filas[0]
    assert.equal(f.baseSinCredito, 100)
    assert.equal(f.igvSinCredito, 18)
    assert.equal(f.total, 118)
    assert.equal(r.filas[0].proveedor, 'DISTRIBUIDORA LIMA SAC')
  })

  it('una nota de crédito del proveedor resta (importes negativos)', () => {
    const r = armarRegistroCompras([
      compra(),
      compra({ compraId: 'compra_2', tipoComprobante: '07', serie: 'F001', numero: '124', items: [{ importe: 59, traeIgv: true, igvConCredito: true }] }),
    ])
    const nc = r.filas.find((f) => f.tipoComprobante === '07')
    assert.ok(nc)
    assert.equal(nc.signo, -1)
    assert.equal(nc.total, -59)
    assert.equal(nc.baseConCredito, -50)
    assert.equal(nc.igvConCredito, -9)
    assert.equal(r.totales.total, 59, '118 de la factura − 59 de la nota de crédito')
    assert.equal(r.totales.igvCreditoFiscal, 9)
  })

  it('varias líneas en un mismo comprobante se suman en una sola fila', () => {
    const r = armarRegistroCompras([
      compra({
        items: [
          { importe: 118, traeIgv: true, igvConCredito: true },
          { importe: 59, traeIgv: true, igvConCredito: true },
          { importe: 20, traeIgv: false },
        ],
      }),
    ])
    assert.equal(r.filas.length, 1, 'un comprobante = una fila')
    const f = r.filas[0]
    assert.equal(f.items, 3)
    assert.equal(f.baseConCredito, 150) // 100 + 50
    assert.equal(f.igvConCredito, 27) // 18 + 9
    assert.equal(f.noGravadas, 20)
    assert.equal(f.total, 197)
  })

  it('el total del registro es la suma de las filas ya redondeadas (cuadra consigo mismo)', () => {
    const r = armarRegistroCompras([
      compra({ compraId: 'a', items: [{ importe: 10.01, traeIgv: true, igvConCredito: true }] }),
      compra({ compraId: 'b', items: [{ importe: 7.77, traeIgv: true, igvConCredito: true }] }),
      compra({ compraId: 'c', items: [{ importe: 3.33, traeIgv: false }] }),
    ])
    const suma = r.filas.reduce((s, f) => s + f.total, 0)
    assert.equal(Number(suma.toFixed(2)), r.totales.total)
    const sumaBase = r.filas.reduce((s, f) => s + f.baseConCredito + f.baseSinCredito + f.noGravadas, 0)
    assert.equal(Number(sumaBase.toFixed(2)), Number((r.totales.baseConCredito + r.totales.baseSinCredito + r.totales.noGravadas).toFixed(2)))
  })

  it('las compras sin los datos que pide SUNAT quedan avisadas (no se esconden)', () => {
    const r = armarRegistroCompras([
      compra({ compraId: 'sin_datos', tipoComprobante: '', serie: '', numero: '', proveedorId: '' }),
    ])
    assert.equal(r.filas.length, 1, 'la fila se muestra igual: el aviso es para completarla')
    assert.deepEqual(r.avisos[0].falta, ['tipo de comprobante', 'serie y número', 'RUC/DNI del proveedor'])
  })

  it('sin compras devuelve un registro vacío en cero (no `null` ni `NaN`)', () => {
    const r = armarRegistroCompras([])
    assert.equal(r.filas.length, 0)
    assert.equal(r.totales.total, 0)
    assert.equal(r.totales.igvCreditoFiscal, 0)
  })
})

/**
 * 🔑 **El comprobante de las compras VIEJAS vive en la nota.** Hasta el 26/09/2026 el modal de compra no tenía
 * campos para el comprobante del proveedor, así que ese dato se escribía a mano en la nota (`FF02-553`). Estas
 * pruebas fijan las dos mitades de la decisión: **se lee la nota cuando faltan los campos nuevos** (y se marca
 * la fila), y **una compra de ahora no depende de la nota para nada**.
 */
describe('comprobante leído de la nota (solo compras anteriores a los campos nuevos)', () => {
  it('lee `SERIE-NÚMERO` de la nota: FF02-553 es una factura', () => {
    assert.deepEqual(comprobanteDeNota('FF02-553'), {
      tipoComprobante: '01',
      serie: 'FF02',
      numero: '553',
      tipoPorSerie: true,
    })
    assert.deepEqual(comprobanteDeNota('F001-123'), {
      tipoComprobante: '01',
      serie: 'F001',
      numero: '123',
      tipoPorSerie: true,
    })
  })

  it('una serie que empieza con B es una boleta, y los ceros de la izquierda no ensucian el número', () => {
    assert.deepEqual(comprobanteDeNota('B001-00000045'), {
      tipoComprobante: '03',
      serie: 'B001',
      numero: '45',
      tipoPorSerie: true,
    })
  })

  it('si la nota dice el tipo con todas las letras, esa palabra manda (y no se marca como leído de la serie)', () => {
    const f = comprobanteDeNota('FACTURA F001-123')
    assert.equal(f?.tipoComprobante, '01')
    assert.equal(f?.tipoPorSerie, false)
    // Con tildes también: la nota es texto libre y se normaliza antes de leerla.
    assert.equal(comprobanteDeNota('Nota de Crédito F001-12')?.tipoComprobante, '07')
    assert.equal(comprobanteDeNota('boleta b001 7')?.tipoComprobante, '03')
  })

  it('⚠️ no adivina: una nota sin comprobante o con una serie que SUNAT no usa devuelve `null`', () => {
    assert.equal(comprobanteDeNota('carga de la semana'), null)
    assert.equal(comprobanteDeNota(''), null)
    assert.equal(comprobanteDeNota(undefined), null)
    assert.equal(comprobanteDeNota('XX99-123'), null, 'una serie que no es F…/B… no se interpreta')
    assert.equal(comprobanteDeNota('553'), null, 'un número suelto no alcanza para el CAR')
  })

  it('la fila de una compra vieja sale completa y MARCADA como leída de la nota', () => {
    const r = armarRegistroCompras(
      [compra({ tipoComprobante: '', serie: '', numero: '', nota: 'FF02-553' })],
      { igvRecuperable: true },
    )
    const f = r.filas[0]
    assert.equal(f.serie, 'FF02')
    assert.equal(f.numero, '553')
    assert.equal(f.tipoComprobante, '01')
    assert.equal(f.car, '2051234567801FF020000000553', 'el CAR se arma igual: es el mismo dato, de otro lado')
    assert.equal(f.leidoDeNota, true)
    assert.equal(f.tipoPorSerie, true)
    assert.deepEqual(r.avisos, [], 'no falta nada: el dato estaba en la nota')
    assert.equal(r.totales.comprobantesDeNota, 1)
  })

  it('🔑 una compra NUEVA no depende de la nota: sus campos propios mandan y la nota no se interpreta', () => {
    const r = armarRegistroCompras([
      compra({ tipoComprobante: '01', serie: 'F001', numero: '123', nota: 'B001-999 (no es esta)' }),
    ])
    const f = r.filas[0]
    assert.equal(f.serie, 'F001')
    assert.equal(f.numero, '123')
    assert.equal(f.leidoDeNota, false, 'la fila no se marca: el dato es declarado')
    assert.equal(f.tipoPorSerie, false)
    assert.equal(r.totales.comprobantesDeNota, 0)
  })

  it('una nota que no se puede leer deja la compra avisada, como antes', () => {
    const r = armarRegistroCompras([
      compra({ compraId: 'vieja', tipoComprobante: '', serie: '', numero: '', nota: 'mercadería surtida' }),
    ])
    assert.equal(r.filas[0].leidoDeNota, false)
    assert.deepEqual(r.avisos[0].falta, ['tipo de comprobante', 'serie y número'])
  })

  it('leer la nota NO cambia los importes: solo completa el comprobante', () => {
    const conCampos = armarRegistroCompras([compra()], { igvRecuperable: true })
    const desdeNota = armarRegistroCompras(
      [compra({ tipoComprobante: '', serie: '', numero: '', nota: 'F001-123' })],
      { igvRecuperable: true },
    )
    assert.equal(desdeNota.filas[0].car, conCampos.filas[0].car)
    assert.equal(desdeNota.totales.total, conCampos.totales.total)
    assert.equal(desdeNota.totales.igvConCredito, conCampos.totales.igvConCredito)
  })
})

describe('export y fechas', () => {
  it('la fila exportada tiene la misma cantidad de campos que la cabecera', () => {
    const r = armarRegistroCompras([compra()])
    const filas = filasExportCompras(r, { ruc: '10459630789', nombre: 'JorFel' })
    const columnas = CABECERA_EXPORT_COMPRAS.split('|').length
    assert.equal(filas[0].split('|').length, columnas)
    assert.match(filas[0], /^202609\|10459630789\|JorFel\|2051234567801F0010000000123\|/)
  })

  it('el periodo y la fecha van como los pide SUNAT', () => {
    assert.equal(periodoDe('2026-09'), '202609')
    assert.equal(fechaRegistro('2026-09-05T15:00:00.000Z'), '05/09/2026')
    assert.equal(fechaRegistro(''), '')
  })
})
