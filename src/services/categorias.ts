import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import {
  CATEGORIAS_POR_DEFECTO,
  claveCategoria,
  iconoDe,
  ordenarCategorias,
  slugCategoria,
  type Categoria,
} from '@/lib/categorias'

/**
 * Categorías de producto administradas (`tblCategorias`). La lógica pura está en
 * `lib/categorias.ts`; acá solo Firestore.
 *
 * El producto guarda el **nombre** en `Producto.categoria` (compatible con los
 * datos que ya existen y con la app RN). Al **renombrar** se actualizan en lote
 * los productos que usaban el nombre anterior para que no queden huérfanos.
 */

// Reexportado para que los consumidores sigan importando desde el servicio.
export {
  CATEGORIAS_POR_DEFECTO,
  ICONOS_CATEGORIA,
  ICONO_POR_DEFECTO,
  categoriasParaFiltros,
  claveCategoria,
  iconoDe,
  ordenarCategorias,
  slugCategoria,
  type Categoria,
} from '@/lib/categorias'

/** Lista las categorías ordenadas por `orden` y, a igual orden, por nombre. */
export async function listarCategorias(): Promise<Categoria[]> {
  try {
    // Sin `orderBy` a propósito: un documento sin el campo `orden` quedaría
    // excluido de la consulta. La colección es chica, se ordena en memoria.
    const snap = await getDocs(collection(db, COL.CATEGORIAS))
    return ordenarCategorias(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Categoria, 'id'>) })))
  } catch (e) {
    console.error('❌ listarCategorias:', e)
    return []
  }
}

/** Cuántos productos usa cada categoría (por nombre). */
export async function contarProductosPorCategoria(): Promise<Record<string, number>> {
  try {
    const snap = await getDocs(collection(db, COL.PRODUCTOS))
    const conteo: Record<string, number> = {}
    snap.forEach((d) => {
      const categoria = String((d.data() as { categoria?: string }).categoria || '').trim()
      if (categoria) conteo[categoria] = (conteo[categoria] || 0) + 1
    })
    return conteo
  } catch (e) {
    console.error('❌ contarProductosPorCategoria:', e)
    return {}
  }
}

/** Productos que usan una categoría (solo ids, para validar borrado y renombrado). */
async function idsProductosConCategoria(nombre: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, COL.PRODUCTOS), where('categoria', '==', nombre)))
  return snap.docs.map((d) => d.id)
}

/** Crea la categoría si falta (id determinista: no duplica si ya existe). */
async function crearCategoriaSiFalta(nombre: string, orden: number, icono?: string): Promise<boolean> {
  const id = slugCategoria(nombre)
  const existentes = await getDocs(collection(db, COL.CATEGORIAS))
  // Compara por nombre normalizado: el id puede diferir si el nombre tenía símbolos.
  const yaEsta = existentes.docs.some((d) => claveCategoria(String((d.data() as { nombre?: string }).nombre || '')) === claveCategoria(nombre))
  if (yaEsta) return false
  await setDoc(doc(db, COL.CATEGORIAS, id), {
    nombre: nombre.trim(),
    orden,
    activo: true,
    icono: icono || iconoDe(nombre),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  return true
}

/**
 * Siembra `tblCategorias` con las categorías que YA usan los productos; si no
 * hay ninguna, con el catálogo por defecto. Es idempotente y **necesario**: al
 * elegir la categoría de una lista obligatoria, una colección vacía dejaría sin
 * categorías al formulario de productos.
 */
export async function asegurarCategoriasIniciales(): Promise<number> {
  try {
    const actuales = await listarCategorias()
    if (actuales.length > 0) return 0
    const conteos = await contarProductosPorCategoria()
    const usadas = Object.keys(conteos)
    const base = usadas.length > 0 ? usadas.map((n) => ({ nombre: n, icono: '' })) : CATEGORIAS_POR_DEFECTO
    let creadas = 0
    for (const [i, c] of base.entries()) {
      if (await crearCategoriaSiFalta(c.nombre, i + 1, c.icono)) creadas++
    }
    return creadas
  } catch (e) {
    console.error('❌ asegurarCategoriasIniciales:', e)
    return 0
  }
}

/** Importa las categorías que usan los productos y aún no están administradas. */
export async function importarCategoriasDesdeProductos(): Promise<{ success: boolean; creadas: number; error?: string }> {
  try {
    const conteos = await contarProductosPorCategoria()
    const actuales = await listarCategorias()
    const claves = new Set(actuales.map((c) => claveCategoria(c.nombre)))
    let orden = actuales.reduce((max, c) => Math.max(max, c.orden), 0)
    let creadas = 0
    for (const nombre of Object.keys(conteos)) {
      if (claves.has(claveCategoria(nombre))) continue
      orden += 1
      if (await crearCategoriaSiFalta(nombre, orden)) creadas++
    }
    return { success: true, creadas }
  } catch (e) {
    console.error('❌ importarCategoriasDesdeProductos:', e)
    return { success: false, creadas: 0, error: (e as Error).message }
  }
}

/**
 * Crea o edita una categoría. Al renombrar, actualiza en lote los productos que
 * usaban el nombre anterior para que no queden huérfanos.
 */
export async function guardarCategoria(datos: { id?: string; nombre: string; orden?: number; activo?: boolean; icono?: string; nombreAnterior?: string }): Promise<{ success: boolean; id?: string; error?: string; productosActualizados?: number }> {
  try {
    const nombre = datos.nombre.trim()
    if (!nombre) return { success: false, error: 'El nombre es obligatorio.' }

    const actuales = await listarCategorias()
    const duplicada = actuales.find((c) => c.id !== datos.id && claveCategoria(c.nombre) === claveCategoria(nombre))
    if (duplicada) return { success: false, error: `Ya existe una categoría "${duplicada.nombre}".` }

    const payload = {
      nombre,
      orden: datos.orden ?? (datos.id ? actuales.find((c) => c.id === datos.id)?.orden ?? 0 : actuales.reduce((max, c) => Math.max(max, c.orden), 0) + 1),
      activo: datos.activo !== false,
      icono: datos.icono || iconoDe(nombre),
      updatedAt: new Date().toISOString(),
    }

    let productosActualizados = 0
    const anterior = (datos.nombreAnterior || '').trim()
    if (datos.id && anterior && claveCategoria(anterior) !== claveCategoria(nombre)) {
      // El producto guarda el NOMBRE: hay que renombrar sus referencias.
      const ids = await idsProductosConCategoria(anterior)
      for (let i = 0; i < ids.length; i += 400) {
        const lote = writeBatch(db)
        ids.slice(i, i + 400).forEach((pid) => lote.update(doc(db, COL.PRODUCTOS, pid), { categoria: nombre, updatedAt: new Date().toISOString() }))
        await lote.commit()
      }
      productosActualizados = ids.length
    }

    if (datos.id) {
      await updateDoc(doc(db, COL.CATEGORIAS, datos.id), payload)
      return { success: true, id: datos.id, productosActualizados }
    }

    const id = slugCategoria(nombre)
    await setDoc(doc(db, COL.CATEGORIAS, id), { ...payload, createdAt: new Date().toISOString() })
    return { success: true, id, productosActualizados }
  } catch (e) {
    console.error('❌ guardarCategoria:', e)
    return { success: false, error: (e as Error).message }
  }
}

/** Borra una categoría, salvo que tenga productos usándola (se puede desactivar). */
export async function eliminarCategoria(id: string, nombre: string): Promise<{ success: boolean; error?: string; productos?: number }> {
  try {
    const ids = await idsProductosConCategoria(nombre)
    if (ids.length > 0) {
      return {
        success: false,
        productos: ids.length,
        error: `No se puede borrar "${nombre}": ${ids.length} producto${ids.length === 1 ? '' : 's'} la usa${ids.length === 1 ? '' : 'n'}. Cambiales la categoría o desactivala para que no aparezca en los filtros.`,
      }
    }
    await deleteDoc(doc(db, COL.CATEGORIAS, id))
    return { success: true }
  } catch (e) {
    console.error('❌ eliminarCategoria:', e)
    return { success: false, error: (e as Error).message }
  }
}
