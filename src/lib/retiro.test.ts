/**
 * **El retiro / cortesía** (`lib/retiro.ts`) y los guardas de cómo se guarda.
 *
 * ⚠️ Lo que estos tests protegen, en orden de gravedad:
 *  1. que un retiro **nunca** se documente con Nota de Venta (no es comprobante de pago y además entraría
 *     al consolidado del día como si fuera una venta cobrada);
 *  2. que un bien **gravado** que se regala **no** se declare como exonerado (el IGV se deja de pagar);
 *  3. que un retiro **no** toque la caja (`total: 0`, sin bolsillos, sin `ventasDelTurno`) ni el contador de
 *     ventas del producto (`vecesVendido`);
 *  4. que el kardex lo trate como **salida** (si no, el stock subiría).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CLASES_RETIRO,
  MOTIVOS_RETIRO,
  TIPO_DOC_RETIRO,
  TIPOS_COMPROBANTE_RETIRO,
  afectacionDelRetiro,
  claseDeDocumento,
  claseDeMotivo,
  claseInfo,
  comprobanteSugeridoParaRetiro,
  comprobanteValidoParaRetiro,
  documentoDelReceptor,
  esRetiro,
  etiquetaDeClase,
  leyendaParaSunat,
  motivoDe,
  resumenRetiros,
  textoRetiro,
  valorReferencialDe,
} from './retiro.ts'
import { esDocumentoDeVenta, importeNetoDeVenta } from './ventas-mensuales.ts'
import { esGratuita } from './sunat-importes.ts'
import { TIPO_DOC_RETIRO_SUNAT, esEnviableASunat, motivoNoEnviarSunat, puedeEnviarseSunat } from './sunat-auto.ts'
import { calcularFilaSire, tipoDocSunat } from './sire-ventas.ts'
import { construirPayloadComprobante } from './sunat.ts'
import { comprobanteDeDocumento, leyendaDeRetiro } from './retiro.ts'
import { datosComprobanteA4 } from './comprobante-a4.ts'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('retiro — los motivos', () => {
  it('son tres y cada uno tiene su leyenda', () => {
    assert.deepEqual(MOTIVOS_RETIRO.map((m) => m.id), ['cortesia', 'consumo', 'muestra'])
    for (const m of MOTIVOS_RETIRO) {
      assert.ok(m.label.length > 0, `${m.id} necesita rótulo`)
      assert.ok(m.leyenda.length > 0, `${m.id} necesita leyenda`)
    }
  })

  it('la cortesía imprime «Transferencia gratuita»', () => {
    assert.equal(motivoDe('cortesia')?.leyenda, 'Transferencia gratuita')
  })

  it('un motivo inventado devuelve null (no se adivina)', () => {
    assert.equal(motivoDe('regalo'), null)
    assert.equal(motivoDe(''), null)
    assert.equal(motivoDe(null), null)
  })
})

describe('retiro — el comprobante (⚠️ nunca una NV)', () => {
  it('solo Boleta y Factura', () => {
    assert.deepEqual([...TIPOS_COMPROBANTE_RETIRO], ['BOLETA', 'FACTURA'])
    assert.equal(comprobanteValidoParaRetiro('BOLETA'), true)
    assert.equal(comprobanteValidoParaRetiro('FACTURA'), true)
  })

  it('la Nota de Venta NO documenta un retiro', () => {
    assert.equal(comprobanteValidoParaRetiro('NV'), false)
    assert.equal(comprobanteValidoParaRetiro('PENDIENTE'), false)
    assert.equal(comprobanteValidoParaRetiro('RETIRO'), false)
    assert.equal(comprobanteValidoParaRetiro(''), false)
    assert.equal(comprobanteValidoParaRetiro(undefined), false)
  })
})

describe('retiro — el código de afectación es el GRATUITO del catálogo 07 (opción B)', () => {
  it('un bien exonerado va como «Transferencia gratuita» (21) o «Retiro» (32)', () => {
    // 🔑 El **producto no cambia** (sigue exonerado en el catálogo): lo que cambia es el **código del
    // comprobante**, que es lo que se declara a SUNAT. Regalarlo a un cliente y quedárselo el negocio no son
    // la misma operación (clase del motivo), aunque el bien sea el mismo.
    assert.equal(afectacionDelRetiro('cortesia', '20'), '21') // transferencia gratuita
    assert.equal(afectacionDelRetiro('muestra', '20'), '21')
    assert.equal(afectacionDelRetiro('consumo', '20'), '32') // retiro (SUNAT no tiene «exonerado – retiro»)
  })

  it('un inafecto va como «Transferencia gratuita» (37) / «Retiro» (32) inafectos', () => {
    for (const af of ['30', '31', '35']) {
      assert.equal(afectacionDelRetiro('cortesia', af), '37')
      assert.equal(afectacionDelRetiro('consumo', af), '32')
    }
  })

  it('sin dato se asume exonerado (nunca se inventa un gravado)', () => {
    assert.equal(afectacionDelRetiro('cortesia', ''), '21')
    assert.equal(afectacionDelRetiro('cortesia', null), '21')
    assert.equal(afectacionDelRetiro('consumo', ''), '32')
  })

  it('⚠️ un bien GRAVADO sigue gravado: el IGV del retiro se declara y se paga', () => {
    // El catálogo no tiene un «gravado – transferencia gratuita» genérico, y declararlo gratuito perdería
    // el IGV del art. 14. En este catálogo no hay bienes gravados; queda fijado por si aparecen.
    assert.equal(afectacionDelRetiro('cortesia', '10'), '10')
    assert.equal(afectacionDelRetiro('consumo', '10'), '10')
  })

  it('ningún código oneroso se cuela: nunca 20 ni 30 para un retiro', () => {
    for (const m of ['cortesia', 'consumo', 'muestra']) {
      for (const af of ['20', '30']) {
        const codigo = afectacionDelRetiro(m, af)
        assert.ok(!['20', '30'].includes(codigo), `${m}/${af} no puede quedar como operación onerosa`)
        assert.equal(esGratuita(codigo), true, `${codigo} tiene que ser un código gratuito (tributo 9996)`)
      }
    }
  })

  it('un motivo inválido revienta (mejor fallar que declarar otra cosa)', () => {
    assert.throws(() => afectacionDelRetiro('regalo', '20'), /Motivo de retiro inválido/)
  })
})

describe('retiro — el valor referencial', () => {
  it('es lo que la mercadería habría costado', () => {
    assert.equal(valorReferencialDe([{ precioVenta: 2.5, cantidad: 4 }, { precioVenta: 10, cantidad: 1 }]), 20)
  })

  it('redondea a 2 decimales', () => {
    assert.equal(valorReferencialDe([{ precioVenta: 0.1, cantidad: 3 }]), 0.3)
    assert.equal(valorReferencialDe([{ precioVenta: 33.333, cantidad: 3 }]), 100)
  })

  it('ignora líneas sin precio o sin cantidad (no inventa importes)', () => {
    assert.equal(valorReferencialDe([{ precioVenta: 0, cantidad: 5 }, { precioVenta: 5, cantidad: 0 }]), 0)
    assert.equal(valorReferencialDe([]), 0)
    assert.equal(valorReferencialDe(null), 0)
  })
})

describe('retiro — el texto que se imprime', () => {
  it('dice la leyenda, que no se cobra y el valor referencial', () => {
    const t = textoRetiro({ leyenda: 'Transferencia gratuita', valorReferencial: 12.5 })
    assert.match(t, /Transferencia gratuita/)
    assert.match(t, /no se cobra/)
    assert.match(t, /12\.50/)
  })
})

describe('retiro — no es una venta del negocio', () => {
  it('se guarda con su propio tipo de documento', () => {
    assert.equal(TIPO_DOC_RETIRO, 'RETIRO')
    assert.equal(esRetiro({ tipoDoc: 'RETIRO' }), true)
    assert.equal(esRetiro({ tipoDoc: 'BOLETA' }), false)
    assert.equal(esRetiro(null), false)
  })

  it('⚠️ un retiro NO suma al reporte de ventas (valdría 0 y no es una venta)', () => {
    const doc = { tipoDoc: 'RETIRO', fecha: '2026-10-08T15:00:00.000Z', venta: { total: 0 } }
    assert.equal(esDocumentoDeVenta(doc), false)
    assert.equal(importeNetoDeVenta(doc), 0)
  })
})

/**
 * 🛡️ **Test-guardas de la escritura**: el retiro se parece a una venta pero **no** lo es. Si alguien copia
 * acá el camino de `registrarVenta`, la caja empieza a contar plata que no entró y el producto suma una
 * venta que nadie hizo.
 */
describe('🛡️ el guardado del retiro (services/ventas.ts)', () => {
  const src = leer('../services/ventas.ts')
  /** El cuerpo de `registrarRetiro`, hasta la función que le sigue. */
  const cuerpo = (() => {
    const desde = src.indexOf('export async function registrarRetiro')
    assert.ok(desde > 0, 'tiene que existir registrarRetiro')
    const hasta = src.indexOf('export async function obtenerRetirosDelTurno')
    assert.ok(hasta > desde, 'los retiros del turno se leen aparte')
    return src.slice(desde, hasta)
  })()

  it('es una salida del inventario, valorizada como tal', () => {
    assert.match(cuerpo, /tipoMovimiento: TIPO_MOV_RETIRO/)
    assert.match(src, /const TIPO_MOV_RETIRO = 'retiro'/)
    assert.match(cuerpo, /valorizacionDeMovimiento\(/)
  })

  it('⚠️ sacar mercadería NO suma `vecesVendido`', () => {
    // `vecesVendido` puede nombrarse en un comentario (explica por qué NO se escribe); lo que no puede
    // haber es una escritura ni un `increment()`.
    assert.ok(!/vecesVendido\s*:/.test(cuerpo), 'un retiro no es una venta: no puede inflar el ranking de productos')
    assert.ok(!/increment\(/.test(cuerpo), 'un retiro no incrementa ningún contador')
  })

  it('⚠️ la caja no se mueve: sin bolsillos, sin turno y con importe cobrado 0', () => {
    assert.match(cuerpo, /pagos: \[\]/)
    assert.match(cuerpo, /efectivo: 0/)
    assert.match(cuerpo, /importeCobrado: 0/)
    assert.ok(!/bolsillosDeVenta/.test(cuerpo), 'un retiro no tiene forma de pago: no puede repartir bolsillos')
    assert.ok(!/ventasDelTurno/.test(cuerpo), 'un retiro no entra a la lista de ventas del turno (esa lista es plata)')
    assert.ok(!/increment\(/.test(cuerpo), 'un retiro no incrementa ningún contador de venta')
  })

  it('🔑 el importe del comprobante ES el valor referencial (opción A)', () => {
    // Si volviera a 0, el papel diría «total 0» con líneas que suman el valor referencial, y el
    // Registro de Ventas declararía un IGV sin base.
    assert.match(cuerpo, /total: valorReferencial/)
    assert.match(cuerpo, /importe_total: valorReferencial/)
    assert.match(cuerpo, /valorReferencial,/)
    assert.ok(!/total: 0/.test(cuerpo), 'el total no puede volver a 0: el comprobante declara el valor referencial')
  })

  it('🔑 comparte serie y contador con las ventas de esa caja (decisión del usuario)', () => {
    // La serie es del punto de emisión, no del motivo: el retiro numera con `claveContador` y escribe
    // `CAMPO_CONTADOR`, el mismo contador de las boletas/facturas ⇒ sin contadores paralelos.
    assert.match(cuerpo, /claveContador\(tipoDoc, serie\)/)
    assert.match(cuerpo, /\[CAMPO_CONTADOR\]: numero/)
    assert.match(cuerpo, /config\.serieFactura \|\| 'F001'/)
    assert.match(cuerpo, /config\.serieBoleta \|\| 'B001'/)
    // La semilla cuenta las ventas Y los retiros de la serie (si el contador todavía no existe).
    assert.match(cuerpo, /for \(const t of \[tipoDoc, TIPO_DOC_RETIRO\]\)/)
    // ⚠️ Nunca más el identificador interno `R-…` como si fuera una serie de SUNAT.
    assert.ok(!/serieNumero = `R-/.test(cuerpo), 'la serie/número tiene que ser la del comprobante (B001-000123)')
  })

  it('🔑 se manda a SUNAT: un comprobante numerado que no se declara es un hueco', () => {
    assert.match(cuerpo, /sunat: \{ estado: 'pendiente', serie, numero, puntoEmision: puntoEmisionDe/)
    assert.ok(!/sunat: null/.test(cuerpo), 'con serie y correlativo propio tiene que entrar a la cola de envío')
  })

  it('guarda el comprobante real para declararlo (tipo interno ≠ tipo SUNAT)', () => {
    assert.match(cuerpo, /comprobante: tipoDoc/)
    assert.match(cuerpo, /retiro: true/)
  })

  it('guarda la leyenda, el motivo y el valor referencial', () => {
    assert.match(cuerpo, /motivoRetiro: \{ id: m\.id, leyenda: m\.leyenda \}/)
    assert.match(cuerpo, /valorReferencial,/)
  })

  it('revalida el comprobante y el documento del receptor en el servicio (el permiso solo se mira en pantalla)', () => {
    assert.match(cuerpo, /comprobanteValidoParaRetiro\(tipoDoc\)/)
    // La validación del DNI/RUC es UNA sola regla (`documentoDelReceptor`, `lib/retiro.ts`), no una copia acá:
    // el backend rechaza un `num_doc` de menos de 8 caracteres y el comprobante ya tiene número.
    assert.match(cuerpo, /documentoDelReceptor\(tipoDoc, clienteDni\)/)
    assert.match(cuerpo, /if \(!receptor\.ok\)/)
    assert.match(cuerpo, /motivoDe\(motivo\)/)
  })

  it('deja rastro en la auditoría con el motivo y el valor', () => {
    assert.match(src, /accion: 'registrar_retiro'/)
  })
})

describe('🛡️ el kardex lo lee como SALIDA', () => {
  it('`retiro` no está en la lista de entradas', () => {
    const src = leer('../services/kardex.ts')
    const entradas = src.match(/const esEntrada = \(tipo: string\) =>\s*\[([\s\S]*?)\]/)
    assert.ok(entradas, 'tiene que existir la lista de tipos de entrada')
    assert.ok(!/'retiro'/.test(entradas[1]), 'si `retiro` entrara como entrada, el stock SUBIRÍA al regalar')
  })

  it('la pantalla del kardex lo rotula (no muestra la clave cruda)', () => {
    assert.match(leer('../pages/Kardex.tsx'), /retiro: 'Retiro \/ cortesía'/)
  })
})

describe('🛡️ el permiso: solo ADMIN y GERENTE', () => {
  const src = leer('../constants/permisos.ts')

  it('la clave existe y está en el grupo de funciones', () => {
    assert.match(src, /retiroGratuito: 'retiroGratuito'/)
    assert.match(src, /'aplicarDescuento', 'descargarXmlSunat', 'retiroGratuito'/)
  })

  it('⚠️ cajero y vendedor NO lo tienen (nace apagado para ellos)', () => {
    const cajero = src.slice(src.indexOf('CAJERO: {'), src.indexOf('VENDEDOR: {'))
    const vendedor = src.slice(src.indexOf('VENDEDOR: {'), src.indexOf('ALMACEN: {'))
    assert.ok(!/retiroGratuito: true/.test(cajero), 'el cajero no puede regalar mercadería')
    assert.ok(!/retiroGratuito: true/.test(vendedor), 'el vendedor no puede regalar mercadería')
  })

  it('la pantalla del PDV solo la abre con ese permiso', () => {
    const pdv = leer('../pages/Pdv.tsx')
    assert.match(pdv, /const puedeRetirar = tienePermiso\('retiroGratuito'\)/)
    assert.match(pdv, /\{!pedidoActivo && puedeRetirar && \(/)
  })

  it('la modal no ofrece Nota de Venta (solo los comprobantes válidos)', () => {
    const modal = leer('../components/RetiroModal.tsx')
    assert.match(modal, /TIPOS_COMPROBANTE_RETIRO\.map/)
    assert.ok(!/['"]NV['"]/.test(modal), 'la modal no puede ofrecer la NV')
    assert.match(modal, /nota de venta no sirve/)
  })
})

/**
 * 🔑 **El retiro se declara**: el documento es `RETIRO` (para no inflar los reportes de ventas) pero ante
 * SUNAT es una boleta (`03`) o una factura (`01`) con su serie y correlativo, y su **valor referencial**
 * va al Registro de Ventas. Estos tests fijan las tres traducciones.
 */
describe('🛡️ la declaración: SUNAT y Registro de Ventas', () => {
  it('el retiro entra a la cola de envío a SUNAT', () => {
    assert.equal(TIPO_DOC_RETIRO_SUNAT, 'RETIRO')
    assert.equal(esEnviableASunat({ id: 'x', tipoDoc: 'RETIRO' }), true)
    // Lo que NO se manda sigue sin mandarse.
    assert.equal(esEnviableASunat({ id: 'x', tipoDoc: 'NV' }), false)
    assert.equal(esEnviableASunat({ id: 'x', tipoDoc: 'PENDIENTE' }), false)
  })

  it('el tipo de comprobante sale del que se emitió, no del documento del receptor', () => {
    assert.equal(tipoDocSunat('RETIRO', 'FACTURA'), '01')
    assert.equal(tipoDocSunat('RETIRO', 'BOLETA'), '03')
    // Sin dato cae a boleta (nunca a factura: declararía un comprobante que no existe).
    assert.equal(tipoDocSunat('RETIRO', null), '03')
  })

  it('el payload a SUNAT de un retiro va como boleta/factura y con su serie', () => {
    const config = { ruc: '20123456789', nombre: 'JORFEL', puntoEmision: '0000', igvPorcentaje: 10 }
    const base = {
      tipoDoc: 'RETIRO',
      serie: 'B001',
      numero: 124,
      venta: {
        id: 'retiro_1',
        fecha: '2026-10-08T15:00:00.000Z',
        comprobante: 'BOLETA',
        retiro: true,
        cliente_nombre: 'CLIENTE',
        cliente_dni: '-',
        total: 12,
        igvPorcentaje: 10,
        items: [{ id: 'p1', nombre: 'Gaseosa', precioVenta: 3, cantidad: 4, tipoAfectacion: '20' }],
      },
    }
    const boleta = construirPayloadComprobante(base, config)
    assert.equal(boleta.tipo, '03')
    assert.equal(boleta.serie, 'B001')
    assert.equal(boleta.numero, 124)

    // Un retiro emitido como FACTURA va como 01, **aunque el receptor tenga DNI**.
    const factura = construirPayloadComprobante(
      { ...base, serie: 'F001', numero: 9, venta: { ...base.venta, comprobante: 'FACTURA', cliente_dni: '12345678' } },
      config,
    )
    assert.equal(factura.tipo, '01')
  })

  it('el valor referencial entra al Registro de Ventas como base (no como 0)', () => {
    const fila = calcularFilaSire(
      {
        tipoDoc: 'RETIRO',
        estado: 'retirado',
        venta: {
          comprobante: 'BOLETA',
          total: 12,
          igvPorcentaje: 10,
          items: [{ id: 'p1', nombre: 'Gaseosa', precioVenta: 3, cantidad: 4, tipoAfectacion: '20' }],
        },
      },
      { igvPorcentaje: 10 },
    )
    assert.equal(fila.tipoDocSunat, '03')
    assert.equal(fila.baseExonerada, 12)
    assert.equal(fila.total, 12)
    assert.equal(fila.igv, 0) // exonerado: no hay IGV que pagar
  })

  it('un retiro gravado declara base + IGV (el impuesto no desaparece)', () => {
    const fila = calcularFilaSire(
      {
        tipoDoc: 'RETIRO',
        venta: {
          comprobante: 'BOLETA',
          total: 110,
          igvPorcentaje: 10,
          items: [{ id: 'p1', nombre: 'Vino', precioVenta: 110, cantidad: 1, tipoAfectacion: '10' }],
        },
      },
      { igvPorcentaje: 10 },
    )
    assert.equal(fila.baseGravada, 100)
    assert.equal(fila.igv, 10)
    assert.equal(fila.total, 110)
  })

  it('la pantalla del registro lo pide explícitamente (si no, no aparecería)', () => {
    const sire = leer('../pages/ReporteSire.tsx')
    assert.match(sire, /const tipos = \['BOLETA', 'FACTURA', 'NC', 'ND', 'RETIRO'\]/)
    assert.match(sire, /RETIRO: \{ label: 'Retiros \(gratuitas\)'/)
  })

  /**
   * 🔑 **El envío a SUNAT es de verdad**: no alcanza con que el documento guarde el bloque `sunat`; el
   * barrido automático y el botón manual deciden con `puedeEnviarseSunat()`. Si el retiro quedara fuera
   * de esa regla, tendría un número emitido que SUNAT nunca recibe.
   */
  it('el barrido automático y el botón manual SÍ lo mandan', () => {
    const hoy = new Date('2026-10-08T15:00:00.000Z')
    const retiro = (extra: Record<string, unknown> = {}) => ({
      id: '2026-10-x_RETIRO-1',
      tipoDoc: 'RETIRO',
      estado: 'retirado',
      serie: 'B001',
      numero: 124,
      fecha: hoy.toISOString(),
      venta: { total: 12, comprobante: 'BOLETA' },
      sunat: { estado: 'pendiente', serie: 'B001', numero: 124 },
      ...extra,
    })

    assert.equal(puedeEnviarseSunat(retiro(), { ahora: hoy.getTime() }), true)
    assert.equal(motivoNoEnviarSunat(retiro(), { ahora: hoy.getTime() }), null)

    // Lo que lo frena es lo mismo que frena a una boleta: sin número, ya aceptado o anulado.
    assert.equal(motivoNoEnviarSunat(retiro({ sunat: { estado: 'pendiente' }, numero: 0 }), { ahora: hoy.getTime() }), 'sin-correlativo')
    assert.equal(
      motivoNoEnviarSunat(retiro({ sunat: { estado: 'aceptado', serie: 'B001', numero: 124 } }), { ahora: hoy.getTime() }),
      'aceptado',
    )
    assert.equal(motivoNoEnviarSunat(retiro({ estado: 'anulada' }), { ahora: hoy.getTime() }), 'anulada')
    // Y una NV o un pedido siguen sin mandarse.
    assert.equal(puedeEnviarseSunat({ id: 'x', tipoDoc: 'NV', numero: 5 }, { ahora: hoy.getTime() }), false)
  })

  it('la pantalla del Registro SUNAT lo lista y le da su botón de envío', () => {
    const rep = leer('../pages/Reportes.tsx')
    assert.match(rep, /\{ key: 'RETIRO', label: 'Retiros sin cobro', color: '#EC4899' \}/)
    assert.match(rep, /d\.tipoDoc === 'BOLETA' \|\| d\.tipoDoc === 'FACTURA' \|\| esRetiro/)
    // ⚠️ Sin PDF propio todavía: no se ofrece imprimir un retiro (saldría sin la leyenda).
    assert.match(rep, /const esRetiroDe = \(d: Doc\) => d\.tipoDoc === 'RETIRO'/)
    // 🔑 Y si alguien lo busca entre las boletas, la pantalla le dice DÓNDE está (no se queda en «no hay»).
    assert.match(rep, /ultimoRetiroMes && filtroTipo !== 'RETIRO'/)
    assert.match(rep, /onClick=\{\(\) => setFiltroTipo\('RETIRO'\)\}/)
    assert.match(rep, /where\('tipoDoc', '==', 'RETIRO'\)/)
  })
})

/**
 * 🔑 **El comprobante impreso**: el retiro usa **los mismos dos PDF** que el resto (ticket de 72 mm y A4).
 * No hay plantilla aparte (`una regla, una implementación`): lo único distinto es el **título** —que sale
 * del comprobante real— y la **leyenda con el valor referencial**, que es lo que exige el RCP.
 */
describe('el PDF del retiro es el mismo comprobante de siempre', () => {
  const config = { ruc: '20123456789', nombre: 'JORFEL', direccion: 'Av. Siempre 123', igvPorcentaje: 10, regionExonerada: true }
  const doc = {
    tipoDoc: 'RETIRO',
    serie: 'B001',
    numero: 124,
    serieNumero: 'B001-000124',
    sunat: null,
    venta: {
      retiro: true,
      comprobante: 'BOLETA',
      fecha: '2026-10-08T15:00:00.000Z',
      cliente_nombre: 'CLIENTE',
      cliente_dni: '-',
      cajero: 'Luis',
      total: 12,
      importe_total: 12,
      importeCobrado: 0,
      igvPorcentaje: 10,
      motivoRetiro: { id: 'cortesia', leyenda: 'Transferencia gratuita' },
      // El documento guarda el código **gratuito** que se declaró (`21`), no el del producto (`20`).
      items: [{ id: 'p1', nombre: 'Gaseosa', precioVenta: 3, cantidad: 4, tipoAfectacion: '21' }],
    },
  }

  it('el comprobante real manda el título (nunca «RETIRO» ni «NOTA DE VENTA»)', () => {
    assert.equal(comprobanteDeDocumento('RETIRO', 'FACTURA'), 'FACTURA')
    assert.equal(comprobanteDeDocumento('RETIRO', 'BOLETA'), 'BOLETA')
    assert.equal(comprobanteDeDocumento('BOLETA', undefined), 'BOLETA')
    assert.equal(leyendaDeRetiro(doc.venta), 'Transferencia gratuita')
    assert.equal(leyendaDeRetiro({}), '')
  })

  it('el A4 sale como boleta electrónica, sin cobro y con el valor referencial', () => {
    const m = datosComprobanteA4({ doc, correlativo: 124, config, tipoDoc: 'RETIRO' })
    assert.equal(m.titulo, 'BOLETA DE VENTA ELECTRÓNICA')
    assert.equal(m.esElectronico, true) // ⇒ lleva QR como cualquier comprobante
    assert.equal(m.pago.formaPago, 'No se cobra')
    assert.deepEqual(m.pago.lineas.map((l) => l.etiqueta), ['Transferencia gratuita', 'Valor referencial (no se cobra)'])
    assert.equal(m.pago.lineas[1].monto, '12.00')
    assert.equal(m.totales.total, 12)
    // 🔑 El papel dice **Op. Gratuitas** con el valor referencial, y el «TOTAL IMPORTE» es 0.00: lo que se
    // paga. Es lo mismo que declara el XML (`9996` + `PayableAmount` 0).
    assert.equal(m.totales.opGratuitas, 12)
    assert.equal(m.totales.opExoneradas, 0, 'lo gratuito ya no se disfraza de operación exonerada')
    assert.equal(m.totales.totalAPagar, 0)
  })

  /**
   * El ticket de 72 mm vive en `lib/pdf.ts`, que importa con el alias `@/…` y por eso **no se puede
   * importar desde el runner de Node**: se verifica leyendo el archivo (como el resto de los guardas).
   * Lo que el guarda fija: el papel de 72 mm no cambia y el retiro imprime la leyenda y el valor
   * referencial con el **mismo** `pagoHTML`.
   */
  it('el ticket de 72 mm es el mismo y dice la leyenda', () => {
    const src = leer('../lib/pdf.ts')
    assert.match(src, /@page \{ size:72mm auto/)
    assert.match(src, /esRetiro \? 'No se cobra'/)
    assert.match(src, /Valor referencial S\/ \$\{totalStr\} · no se cobra/)
    assert.ok(!/NOTA DE VENTA/.test(src) || /TITULOS\[tipoDoc\] \|\| 'NOTA DE VENTA'/.test(src), 'el título sale de TITULOS, no fijo')
  })

  it('🛡️ no hay una plantilla de retiro aparte (una sola implementación)', () => {
    for (const f of ['../lib/pdf.ts', '../lib/comprobante-a4.ts']) {
      const src = leer(f)
      assert.match(src, /comprobanteDeDocumento\(tipoDoc/, `${f} tiene que resolver el comprobante real`)
      assert.match(src, /leyendaDeRetiro\(/, `${f} tiene que imprimir la leyenda del retiro`)
    }
  })
})

/**
 * 🔑 **Las DOS clases de operación.** SUNAT no trata igual la **transferencia gratuita** (la mercadería sale
 * hacia un cliente) que el **retiro de bienes** (se la queda el propio negocio): son códigos distintos del
 * catálogo 07 (`'21'` contra `'13'`/`'32'`). Bajo la **opción A** las dos se declaran igual —línea onerosa
 * con la afectación del bien—, así que lo que estos tests protegen es:
 *  1. que la clase **se guarde y se lea** (sale del motivo, no de una columna nueva ni de una migración);
 *  2. que **NO cambie ningún importe ni el XML** —si algún día alguien la metiera en la cuenta, el
 *     comprobante y el Registro de Ventas dirían cosas distintas—;
 *  3. que un documento del receptor **a medio tipear no llegue a emitirse** (el backend lo rechaza y el
 *     comprobante ya tiene número: no se corrige).
 */
describe('retiro — las dos clases: transferencia gratuita vs retiro de bienes', () => {
  it('cada motivo declara su clase, y las dos clases existen con su rótulo', () => {
    assert.deepEqual(CLASES_RETIRO.map((c) => c.id), ['cliente', 'propio'])
    assert.equal(claseDeMotivo('cortesia'), 'cliente') // se le regala a un cliente
    assert.equal(claseDeMotivo('muestra'), 'cliente') // la muestra también sale hacia un tercero
    assert.equal(claseDeMotivo('consumo'), 'propio') // se lo queda el negocio
    assert.equal(claseDeMotivo('regalo'), null)
    assert.equal(claseDeMotivo(null), null)
    for (const m of MOTIVOS_RETIRO) {
      const c = claseInfo(m.clase)
      assert.ok(c, `${m.id}: la clase ${m.clase} no tiene rótulo`)
      assert.ok(c.detalle.length > 0, `${m.id}: la clase necesita detalle`)
    }
  })

  it('se lee del documento guardado (`venta.motivoRetiro.id`) y no se adivina', () => {
    const retiro = (id?: string) => ({ tipoDoc: 'RETIRO', venta: id ? { motivoRetiro: { id } } : {} })
    assert.equal(claseDeDocumento(retiro('cortesia')), 'cliente')
    assert.equal(claseDeDocumento(retiro('consumo')), 'propio')
    // Sin motivo (o con uno inventado) la clase es `null`: no se supone.
    assert.equal(claseDeDocumento(retiro()), null)
    assert.equal(claseDeDocumento(retiro('regalo')), null)
    // Un documento que no es un retiro no tiene clase, aunque traiga el campo por error.
    assert.equal(claseDeDocumento({ tipoDoc: 'BOLETA', venta: { motivoRetiro: { id: 'consumo' } } }), null)
    assert.equal(etiquetaDeClase('propio'), 'Retiro de bienes')
    assert.equal(etiquetaDeClase(null), '')
  })

  it('el resumen separa las dos clases y suma el valor referencial', () => {
    const docs = [
      { tipoDoc: 'RETIRO', total: 12, venta: { motivoRetiro: { id: 'cortesia' } } },
      { tipoDoc: 'RETIRO', total: 30.5, venta: { motivoRetiro: { id: 'muestra' } } },
      { tipoDoc: 'RETIRO', total: 8, venta: { motivoRetiro: { id: 'consumo' } } },
      { tipoDoc: 'RETIRO', total: 4, venta: {} }, // viejo / sin motivo
      { tipoDoc: 'BOLETA', total: 100, venta: {} }, // no es un retiro: no entra
      { tipoDoc: 'NC', total: -5, venta: {} },
    ]
    const r = resumenRetiros(docs)
    assert.deepEqual(
      r.map((x) => [x.clase, x.etiqueta, x.cantidad, x.total]),
      [
        ['cliente', 'Transferencia gratuita', 2, 42.5],
        ['propio', 'Retiro de bienes', 1, 8],
        [null, 'Retiros sin motivo', 1, 4],
      ],
    )
    // Sin retiros no hay tarjetas (no se dibuja un 0 que confunde).
    assert.deepEqual(resumenRetiros([]), [])
    assert.deepEqual(resumenRetiros(null), [])
    // Y los céntimos se redondean (0.1 + 0.2 no puede dar 0.30000000000000004).
    assert.equal(resumenRetiros([
      { tipoDoc: 'RETIRO', total: 0.1, venta: { motivoRetiro: { id: 'cortesia' } } },
      { tipoDoc: 'RETIRO', total: 0.2, venta: { motivoRetiro: { id: 'cortesia' } } },
    ])[0].total, 0.3)
  })

  it('🛡️ la clase NO cambia los importes ni el XML (opción A)', () => {
    const cfg = { ruc: '20123456789', nombre: 'JORFEL', direccion: 'jr. tal 123', igvPorcentaje: 10, puntoEmision: '0000' }
    const doc = (id: string) => ({
      tipoDoc: 'RETIRO',
      serie: 'B001',
      numero: 124,
      venta: {
        id: 'retiro_1',
        fecha: '2026-10-08T15:00:00.000Z',
        comprobante: 'BOLETA',
        retiro: true,
        cliente_nombre: 'CLIENTE',
        cliente_dni: '-',
        total: 12,
        igvPorcentaje: 10,
        motivoRetiro: { id },
        items: [{ id: 'p1', nombre: 'Gaseosa', precioVenta: 3, cantidad: 4, tipoAfectacion: '20' }],
      },
    })
    // El comprobante, el registro y el payload son **idénticos**: la clase es para reportar, no para declarar.
    assert.deepEqual(calcularFilaSire(doc('cortesia'), cfg), calcularFilaSire(doc('consumo'), cfg))
    assert.deepEqual(construirPayloadComprobante(doc('cortesia'), cfg), construirPayloadComprobante(doc('consumo'), cfg))
  })

  /**
   * El payload es lo que recibe `appadm-sunat` y valida con Pydantic (`InvoiceCreate`/`ItemIn`/`ClienteIn`).
   * Este test espeja esas restricciones: si alguna se rompe, el envío se rechaza **después** de haber
   * consumido un correlativo (y un comprobante numerado no se puede corregir).
   */
  it('el payload de un retiro cumple lo que exige el backend', () => {
    const cfg = { ruc: '20123456789', nombre: 'JORFEL', direccion: 'jr. tal 123', igvPorcentaje: 10, puntoEmision: '0000' }
    const dosDecimales = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6
    const p = construirPayloadComprobante(
      {
        tipoDoc: 'RETIRO',
        serie: 'B001',
        numero: 41,
        venta: {
          id: 'retiro_1',
          fecha: '2026-10-08T15:00:00.000Z',
          comprobante: 'BOLETA',
          retiro: true,
          cliente_nombre: 'CLIENTE',
          cliente_dni: '-',
          total: 12,
          igvPorcentaje: 10,
          motivoRetiro: { id: 'cortesia', leyenda: 'Transferencia gratuita' },
          items: [
            { id: 'p1', nombre: 'Gaseosa', precioVenta: 3, cantidad: 4, tipoAfectacion: '20' },
            { id: 'p2', nombre: 'Vino', precioVenta: 11.8, cantidad: 1, tipoAfectacion: '10' },
          ],
        },
      },
      cfg,
    ) as Record<string, any>

    assert.equal(p.tipo, '03') // boleta
    assert.equal(p.serie.length, 4)
    assert.ok(p.numero > 0, 'Pydantic: numero gt=0')
    assert.match(p.ruc_emisor, /^\d{11}$/)
    assert.match(p.punto_emision, /^\d{4}$/)
    assert.match(p.fecha_emision, /^\d{4}-\d{2}-\d{2}$/)
    // El importe declarado es el valor referencial (y el backend, además, lo rearma por línea).
    assert.ok(p.totales.total > 0, 'el importe del comprobante es el valor referencial')
    // Sin DNI: consumidor final, con los 8 ceros que exige el largo mínimo.
    assert.equal(p.cliente.tipo_doc, '1')
    assert.equal(p.cliente.num_doc, '00000000')
    assert.ok(p.cliente.num_doc.length >= 8 && p.cliente.num_doc.length <= 11)
    assert.ok(p.cliente.razon_social.length >= 1)
    assert.ok(p.items.length >= 1, 'Pydantic: min_length=1')
    for (const it of p.items) {
      assert.ok(it.cantidad > 0, `${it.descripcion}: cantidad gt=0`)
      assert.ok(dosDecimales(it.cantidad), `${it.descripcion}: cantidad con 2 decimales`)
      assert.ok(dosDecimales(it.precio_unitario), `${it.descripcion}: precio_unitario con 2 decimales`)
      assert.match(it.tipo_afectacion, /^\d{2}$/)
      assert.ok(it.codigo.length <= 20)
      assert.ok(it.descripcion.length >= 1 && it.descripcion.length <= 250)
      assert.ok(it.unidad.length <= 4)
    }
    // La tasa viaja como factor (0.18/0.10), no como 18.
    assert.ok(Number(p.tasa_igv) > 0 && Number(p.tasa_igv) <= 1)
    // 🔑 **La leyenda viaja**: el XML lo arma el backend, así que sin esto SUNAT guardaría el comprobante
    // como una venta corriente de S/ 12.00 al contado (art. 8 del RCP: la leyenda va en el comprobante).
    assert.equal(p.leyenda, 'TRANSFERENCIA GRATUITA - NO SE COBRA. Valor referencial: S/ 12.00')
  })

  it('la leyenda del XML es texto plano, en mayúsculas y con el valor referencial', () => {
    const v = (leyenda: string, valorReferencial: number) => ({ motivoRetiro: { leyenda }, valorReferencial, total: 0 })
    assert.equal(
      leyendaParaSunat(v('Transferencia gratuita', 12)),
      'TRANSFERENCIA GRATUITA - NO SE COBRA. Valor referencial: S/ 12.00',
    )
    assert.equal(
      leyendaParaSunat(v('Retiro para uso propio', 8.5)),
      'RETIRO PARA USO PROPIO - NO SE COBRA. Valor referencial: S/ 8.50',
    )
    // Sin leyenda guardada: una genérica, nunca una nota vacía.
    assert.match(leyendaParaSunat({ total: 3 }), /^TRANSFERENCIA GRATUITA - NO SE COBRA\./)
    // Sin nada: importe 0.00, no «NaN».
    assert.match(leyendaParaSunat(null), /S\/ 0\.00$/)
    // ⚠️ Y una VENTA normal no lleva leyenda: el payload queda igual que siempre.
    const ventaNormal = construirPayloadComprobante(
      {
        tipoDoc: 'BOLETA',
        serie: 'B001',
        numero: 7,
        venta: { fecha: '2026-10-08T15:00:00.000Z', cliente_dni: '12345678', total: 3, items: [{ id: 'p1', nombre: 'X', precioVenta: 3, cantidad: 1, tipoAfectacion: '20' }] },
      },
      { ruc: '20123456789', nombre: 'JORFEL' },
    ) as Record<string, any>
    assert.equal('leyenda' in ventaNormal, false, 'una venta normal no manda leyenda al backend')
  })

  it('🛡️ un documento del receptor a medio tipear NO se emite', () => {
    // Boleta: nada (consumidor final) o 8/11 dígitos.
    assert.deepEqual(documentoDelReceptor('BOLETA', ''), { ok: true, doc: '' })
    assert.equal(documentoDelReceptor('BOLETA', '-').doc, '')
    assert.equal(documentoDelReceptor('BOLETA', '  12345678  ').doc, '12345678')
    assert.equal(documentoDelReceptor('BOLETA', '20123456789').doc, '20123456789')
    // ⚠️ Esto es lo que el backend rechazaría (`num_doc` de 8 a 11 caracteres).
    assert.equal(documentoDelReceptor('BOLETA', '123').ok, false)
    assert.equal(documentoDelReceptor('BOLETA', '123456789').ok, false)
    assert.equal(documentoDelReceptor('BOLETA', '1234567a').ok, false)
    // Factura: el RUC es obligatorio.
    assert.equal(documentoDelReceptor('FACTURA', '20123456789').ok, true)
    assert.equal(documentoDelReceptor('FACTURA', '12345678').ok, false)
    const sinRuc = documentoDelReceptor('FACTURA', '')
    assert.equal(sinRuc.ok, false)
    assert.match(String(sinRuc.error), /RUC/)
    // Y la pantalla y el servicio usan esta regla (no una copia cada uno).
    assert.match(leer('../services/ventas.ts'), /documentoDelReceptor\(tipoDoc, clienteDni\)/)
    assert.match(leer('../components/RetiroModal.tsx'), /documentoDelReceptor\(tipoDoc, documento\)/)
  })

  it('las pantallas muestran la clase (SIRE, Registro SUNAT y la modal)', () => {
    const sire = leer('../pages/ReporteSire.tsx')
    assert.match(sire, /resumenRetiros\(docsCalc/)
    assert.match(sire, /etiquetaDeClase\(claseDeDocumento\(d\)\)/)
    assert.match(sire, /\{ key: 'RETIRO', label: 'Retiros' \}/)
    const rep = leer('../pages/Reportes.tsx')
    assert.match(rep, /etiquetaDeClase\(claseDeDocumento\(d\)\)/)
    assert.match(rep, /leyendaDeRetiro\(d\.venta\)/)
    assert.match(leer('../components/RetiroModal.tsx'), /claseInfo\(elegido\.clase\)/)
  })
})

/**
 * 🔑 **El cliente NO se digita dos veces.** En el PDV ya se cargó el DNI/RUC, el nombre y la dirección en el
 * panel *Cliente*; el retiro es de **la misma persona**, así que la modal arranca con esos datos (y el
 * comprobante sugerido: RUC ⇒ Factura, DNI ⇒ Boleta). Lo que estos tests fijan: que el dato **viaje** y que
 * un documento a medio tipear **no** se precargue (el backend lo rechazaría y el comprobante ya tiene número).
 */
describe('retiro — el cliente que ya está en la venta viaja al retiro', () => {
  it('el comprobante se sugiere con el documento (RUC ⇒ Factura)', () => {
    assert.equal(comprobanteSugeridoParaRetiro('20123456789'), 'FACTURA')
    assert.equal(comprobanteSugeridoParaRetiro('12345678'), 'BOLETA')
    assert.equal(comprobanteSugeridoParaRetiro(''), 'BOLETA')
    assert.equal(comprobanteSugeridoParaRetiro(null), 'BOLETA')
    assert.equal(comprobanteSugeridoParaRetiro(undefined), 'BOLETA')
  })

  it('lo que se precarga es exactamente lo que la modal va a mandar', () => {
    // La modal hace: sugerir el comprobante, normalizar el documento y precargarlo **solo si es válido**.
    const precargar = (doc: string) => {
      const tipo = comprobanteSugeridoParaRetiro(doc)
      const rev = documentoDelReceptor(tipo, doc)
      return { tipo, documento: rev.ok ? rev.doc : '' }
    }
    assert.deepEqual(precargar('20123456789'), { tipo: 'FACTURA', documento: '20123456789' })
    assert.deepEqual(precargar('12345678'), { tipo: 'BOLETA', documento: '12345678' })
    assert.deepEqual(precargar(''), { tipo: 'BOLETA', documento: '' })
    // A medio tipear no se precarga nada (el submit lo frenaría, pero no se arrastra el error).
    assert.deepEqual(precargar('123'), { tipo: 'BOLETA', documento: '' })
    assert.deepEqual(precargar('123456789'), { tipo: 'BOLETA', documento: '' })
  })

  it('el PDV le pasa el cliente a la modal (y la modal lo usa tal cual)', () => {
    const pdv = leer('../pages/Pdv.tsx')
    assert.match(pdv, /clienteInicial=\{\{ documento: clienteDni, nombre: clienteNombre, direccion: clienteDireccion \}\}/)
    const modal = leer('../components/RetiroModal.tsx')
    assert.match(modal, /const tipoSugerido = comprobanteSugeridoParaRetiro\(clienteInicial\?\.documento\)/)
    assert.match(modal, /comprobanteSugeridoParaRetiro\(clienteInicial\?\.documento\)/)
    assert.match(modal, /useState\(docInicial\)/)
    assert.match(modal, /useState\(nombreInicial\)/)
    assert.match(modal, /useState<TipoComprobanteRetiro>\(tipoSugerido\)/)
    // Y la dirección también viaja hasta el documento.
    assert.match(modal, /clienteDireccion: direccionInicial/)
    assert.match(leer('../services/ventas.ts'), /cliente_direccion: String\(clienteDireccion\)\.trim\(\)/)
  })

  /**
   * 🔑 **El cliente se limpia COMPLETO al terminar** (venta, pedido, pausa y retiro). Si se limpia el DNI y
   * el nombre pero **no la dirección**, la venta siguiente sale con la dirección del cliente anterior sin
   * que nadie la haya escrito — y esa dirección se imprime y se manda a SUNAT en una factura.
   */
  it('🛡️ cuando se limpia el cliente, se limpia también la dirección', () => {
    const pdv = leer('../pages/Pdv.tsx')
    const resets = [...pdv.matchAll(/setClienteDni\(''\)/g)]
    assert.ok(resets.length >= 4, `tienen que ser los 4 cierres (venta, pedido, pausa, retiro) — hay ${resets.length}`)
    for (const m of resets) {
      const desde = m.index ?? 0
      const trozo = pdv.slice(desde, desde + 220)
      assert.match(
        trozo,
        /setClienteDireccion\(''\)/,
        'si se limpia el DNI hay que limpiar la dirección: si no, se arrastra a la venta siguiente',
      )
    }
  })
})

