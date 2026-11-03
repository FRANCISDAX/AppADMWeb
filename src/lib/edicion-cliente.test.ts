/**
 * **Cambiarle el cliente a una nota de venta** (`lib/edicion-cliente.ts`).
 *
 * ⚠️ Lo que estos tests protegen, en orden de gravedad:
 *  1. que **no** se pueda editar una nota que ya entró a la **boleta consolidada** (su importe ya está
 *     declarado: se corrige con nota de crédito, no editando) ni una anulada;
 *  2. que la edición sea **solo de notas de venta** (una boleta o factura emitida no se retoca);
 *  3. que un **RUC sin razón social** no pase, y que el DNI/RUC quede en 8/11 dígitos;
 *  4. que el vacío se guarde como `'-'`/`'CLIENTE'` (el mismo formato con el que nace una nota al
 *     consumidor final), y que el aviso de **crédito** aparezca cuando la deuda va a cambiar de dueño.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { clienteParaGuardar, revisionDocumentoCliente, revisionEdicionCliente } from './edicion-cliente.ts'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('editar cliente de una NV — la regla', () => {
  const nv = (extra: Record<string, unknown> = {}) => ({ tipoDoc: 'NV', estado: 'pagado', venta: { tipoPago: 'efectivo' }, ...extra })

  it('una nota de venta normal se puede editar', () => {
    const r = revisionEdicionCliente(nv())
    assert.equal(r.permitido, true)
    assert.equal(r.motivo, null)
    assert.equal(r.aviso, null)
  })

  it('⚠️ una nota YA CONSOLIDADA no se toca (el importe está declarado)', () => {
    const r = revisionEdicionCliente(nv({ sunat: { consolidado: true } }))
    assert.equal(r.permitido, false)
    assert.match(String(r.motivo), /consolidada/)
    assert.match(String(r.motivo), /nota de crédito/)
  })

  it('una nota anulada tampoco', () => {
    const r = revisionEdicionCliente(nv({ estado: 'anulada' }))
    assert.equal(r.permitido, false)
    assert.match(String(r.motivo), /anulada/)
  })

  it('solo notas de venta: una boleta o factura emitida no se retoca', () => {
    for (const tipoDoc of ['BOLETA', 'FACTURA', 'NC', 'ND', 'RETIRO', 'PENDIENTE']) {
      const r = revisionEdicionCliente({ tipoDoc, estado: 'pagado', venta: {} })
      assert.equal(r.permitido, false, `${tipoDoc} no debería poder editarse`)
    }
    assert.equal(revisionEdicionCliente(null).permitido, false)
  })

  it('⚠️ avisa cuando la nota está a crédito (la deuda cambia de cuenta)', () => {
    const r = revisionEdicionCliente(nv({ venta: { tipoPago: 'credito' } }))
    assert.equal(r.permitido, true)
    assert.match(String(r.aviso), /crédito/)
    assert.match(String(r.aviso), /deuda/)
  })
})

describe('editar cliente de una NV — el documento de identidad', () => {
  it('vacío es válido: es el consumidor final de siempre', () => {
    assert.equal(revisionDocumentoCliente('', '').valido, true)
    assert.equal(revisionDocumentoCliente('-', null).valido, true)
    assert.equal(revisionDocumentoCliente(undefined, undefined).valido, true)
  })

  it('DNI de 8 y RUC de 11 pasan', () => {
    assert.equal(revisionDocumentoCliente('12345678', 'Ana').valido, true)
    assert.equal(revisionDocumentoCliente('20123456789', 'Empresa SAC').valido, true)
  })

  it('un RUC sin razón social no pasa (el papel no serviría para nada)', () => {
    const r = revisionDocumentoCliente('20123456789', '   ')
    assert.equal(r.valido, false)
    assert.match(String(r.motivo), /razón social/)
  })

  it('longitudes raras y letras se rechazan', () => {
    for (const doc of ['123', '123456789', '123456789012', '1234567A']) {
      assert.equal(revisionDocumentoCliente(doc, 'Ana').valido, false, `${doc} debería rechazarse`)
    }
  })
})

describe('editar cliente de una NV — lo que se guarda', () => {
  it('normaliza el vacío igual que al emitir (CLIENTE / -)', () => {
    assert.deepEqual(clienteParaGuardar({ nombre: '', documento: '' }), {
      cliente_nombre: 'CLIENTE',
      cliente_dni: '-',
      cliente_direccion: '',
      cliente_telefono: '',
    })
  })

  it('recorta espacios y guarda dirección y teléfono', () => {
    const c = clienteParaGuardar({ nombre: '  Ana Pérez ', documento: ' 12345678 ', direccion: ' Av. Perú 123 ', telefono: ' 999888777 ' })
    assert.equal(c.cliente_nombre, 'Ana Pérez')
    assert.equal(c.cliente_dni, '12345678')
    assert.equal(c.cliente_direccion, 'Av. Perú 123')
    assert.equal(c.cliente_telefono, '999888777')
  })
})

describe('🛡️ el guardado revalida la regla (no alcanza con esconder el botón)', () => {
  it('el servicio usa la misma revisión antes de escribir', () => {
    const src = leer('../services/ventas.ts')
    assert.match(src, /export async function editarClienteDeNotaVenta/)
    assert.match(src, /revisionEdicionCliente\(/)
    assert.match(src, /revisionDocumentoCliente\(/)
    assert.match(src, /clienteParaGuardar\(/)
    // La auditoría guarda el antes y el después: quién lo cambió y qué había.
    assert.match(src, /accion: 'editar_cliente_nv'/)
    assert.match(src, /antes, despues: nuevo/)
  })

  it('la pantalla solo ofrece el botón con el permiso y la nota editable', () => {
    const rep = leer('../pages/Reportes.tsx')
    assert.match(rep, /tienePermiso\('editarClienteVenta'\)/)
    assert.match(rep, /revisionEdicionCliente\(/)
    assert.match(rep, /<EditarClienteModal/)
  })

  it('la nota de venta guarda el cliente en `venta.*`, no a nivel del documento', () => {
    const src = leer('../services/ventas.ts')
    assert.match(src, /'venta\.cliente_nombre'|venta\.cliente_nombre/)
  })
})
