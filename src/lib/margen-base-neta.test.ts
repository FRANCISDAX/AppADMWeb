/**
 * **Guarda: la plata se mide siempre en la misma base (sin IGV cuando corresponde).**
 *
 * 📌 **Lo que la motivó** (medido el 25/09/2026 en el emulador, con un negocio de Lima que compra y vende
 * gravado): el precio de venta es **final al público** (lleva el IGV adentro) pero los reportes le
 * restaban el costo directamente, así que una venta de S/ 150 con un costo neto de S/ 100 mostraba
 * **33%** de margen donde el negocio ganaba **21,3%**; cargando el total de la factura (S/ 118) el
 * porcentaje coincidía por casualidad pero el **inventario quedaba 18% arriba**; y el aviso **BAJO
 * COSTO** no disparaba con un precio de S/ 110 contra un costo de S/ 100 (sin IGV el precio es 93,22:
 * se estaba vendiendo a pérdida). Tres lugares, la misma mezcla de bases.
 *
 * 🔑 La regla única está en **`lib/precio-venta.ts`** (`margenDePrecio`, `precioSinIgv`, `costoDeCompra`)
 * y **`lib/sunat-importes.ts`** (`afectacionGuardada`). Estos tests leen los archivos que la usan para
 * que nadie vuelva a escribir la aritmética a mano: un test que solo repite el cálculo no protege nada.
 *
 * ⚠️ **Para un producto exonerado (`'20'`, el 100% del catálogo de esta región) el neto ES el precio**,
 * así que estos cambios no mueven un solo número; por eso la guarda también fija que el interruptor
 * nazca **apagado**.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (rel: string) => readFileSync(join(raiz, rel), 'utf8')

/** Saca los comentarios para no confundir lo que dice el código con lo que explica. */
const soloCodigo = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el margen de los reportes se mide sobre la base neta', () => {
  it('Análisis usa la regla única y no resta el costo a un precio con IGV', () => {
    const src = leer('services/analisis.ts')
    assert.match(src, /margenDePrecio\(/, 'tiene que usar la regla de `lib/precio-venta.ts`')
    assert.match(src, /afectacionGuardada\(/, 'la afectación sale del ítem guardado / del producto')
    assert.doesNotMatch(soloCodigo(src), /precioVenta\s*-\s*costo/, 'la resta a mano ya no vuelve')
  })

  it('los reportes de inventario también, y el margen cuadra con la resta que se muestra', () => {
    const src = leer('lib/inventario-reportes.ts')
    assert.match(src, /margenDePrecio\(/)
    assert.match(src, /precioSinIgv\(/)
    assert.doesNotMatch(soloCodigo(src), /venta\s*-\s*costo/)
  })
})

describe('el aviso BAJO COSTO compara contra el precio sin IGV y en la misma unidad', () => {
  it('el badge del carrito y el aviso del cobro usan `precioSinIgv` sobre la UNIDAD BASE', () => {
    const src = leer('pages/Pdv.tsx')
    // ⚠️ Unidad base contra unidad base: el costo es por unidad base, así que compararlo con el precio de la
    // **presentación** (una caja a S/ 38 contra un costo de S/ 3.17) daba «está sobre el costo» siempre.
    assert.match(src, /precioSinIgv\(precioFinal\(p\), p\.tipoAfectacion\) < costoActual/, 'el badge del carrito')
    assert.match(src, /precioSinIgv\(precioBase, p\.tipoAfectacion\) < costo/, 'el aviso antes de cobrar')
    assert.doesNotMatch(soloCodigo(src), /precioFinal\(p\) \* factorActual < costoActual/, 'la comparación vieja ya no vuelve')
    assert.doesNotMatch(soloCodigo(src), /precioSinIgv\(precioItem, p\.tipoAfectacion\)/, 'ni la de presentación contra unidad base')
  })
})

describe('el costo de una compra se separa en un solo lugar', () => {
  it('la compra guarda el costo con `costoDeCompra` y conserva el total pagado', () => {
    const src = leer('services/compras.ts')
    assert.match(src, /costoDeCompra\(costoBase,/, 'la regla vive en `lib/precio-venta.ts`')
    assert.match(src, /totalPagado = lista\.reduce/, 'lo que salió de la caja NO cambia: es el total de la factura')
  })

  it('el modal de compra muestra el mismo número que se va a guardar', () => {
    const src = leer('components/ModalCompra.tsx')
    assert.match(src, /costoDeCompra\(costoBaseItem/)
    assert.match(src, /igvRecuperable: config\.igvRecuperable/, 'le pasa la config al servicio (una sola decisión)')
    // 🔑 **`traeIgv` es un dato del PAPEL** (lo que dice el comprobante del proveedor), no del producto: es lo
    // que decide si el costo se guarda sin IGV **y** cómo entra la línea en el Registro de Compras. El modal y
    // el servicio tienen que usar el mismo criterio (`!traeIgv` ⇒ el monto cargado no trae IGV que separar).
    assert.match(src, /const traeIgv = i\.traeIgv \?\? Boolean\(config\.igvRecuperable\)/, 'el ítem decide con el papel')
    assert.match(src, /traeIgv: i\.traeIgv \?\? Boolean\(config\.igvRecuperable\)/, 'y se lo pasa al servicio')
    assert.match(src, /yaSinIgv: !traeIgv/, 'la separación del costo usa el mismo dato')
  })
})

describe('el interruptor nace APAGADO (el IGV es costo)', () => {
  it('`CONFIG_POR_DEFECTO.igvRecuperable` es false', () => {
    const src = leer('constants/tributario.ts')
    assert.match(src, /igvRecuperable: false/, 'una empresa que no lo configure tiene que seguir igual que siempre')
  })
})
