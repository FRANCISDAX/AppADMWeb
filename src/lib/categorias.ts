/**
 * Categorías de producto: parte **pura** (sin Firebase), para poder probarla
 * aislada. Las operaciones de Firestore viven en `services/categorias.ts`.
 *
 * El producto guarda el **nombre** de la categoría en `Producto.categoria`; el
 * `id` del documento es un slug del nombre, así el sembrado es idempotente.
 */

export type Categoria = {
  id: string
  nombre: string
  orden: number
  activo: boolean
  icono?: string
  createdAt?: string
  updatedAt?: string
}

/** Iconos Ionicons que la app RN sabe pintar (el web los elige de acá). */
export const ICONOS_CATEGORIA: { icono: string; label: string }[] = [
  { icono: 'fast-food-outline', label: 'Comida' },
  { icono: 'cafe-outline', label: 'Bebidas' },
  { icono: 'ice-cream-outline', label: 'Dulces' },
  { icono: 'nutrition-outline', label: 'Frutas / verduras' },
  { icono: 'wine-outline', label: 'Licores' },
  { icono: 'home-outline', label: 'Limpieza / hogar' },
  { icono: 'shirt-outline', label: 'Ropa' },
  { icono: 'construct-outline', label: 'Ferretería' },
  { icono: 'basket-outline', label: 'Abarrotes' },
  { icono: 'paw-outline', label: 'Mascotas' },
  { icono: 'medkit-outline', label: 'Salud' },
  { icono: 'phone-portrait-outline', label: 'Tecnología' },
  { icono: 'gift-outline', label: 'Regalos' },
  { icono: 'school-outline', label: 'Útiles' },
  { icono: 'car-outline', label: 'Automotriz' },
  { icono: 'apps-outline', label: 'Otros' },
]

export const ICONO_POR_DEFECTO = 'apps-outline'

/**
 * Categoría con la que se registran los **items manuales** del PDV (los que no
 * salen del catálogo: embalaje, hielo, varios). Antes se guardaban con
 * `categoria: ''` y aparecían como "Sin categoría" en los reportes.
 */
export const CATEGORIA_MANUAL = 'VARIOS'

/**
 * Etiqueta para las ventas **antiguas** que no guardaron categoría (versiones
 * previas de la app): no se puede saber a qué categoría pertenecían. Se deja
 * corta porque los reportes la muestran en columnas angostas.
 */
export const CATEGORIA_SIN_ASIGNAR = 'Sin categoría'

/** Categorías del catálogo original, para una instalación nueva. */
export const CATEGORIAS_POR_DEFECTO: { nombre: string; icono: string }[] = [
  { nombre: 'Productos', icono: 'fast-food-outline' },
  { nombre: 'Bebidas', icono: 'cafe-outline' },
  { nombre: 'Dulces', icono: 'ice-cream-outline' },
  { nombre: 'Otros', icono: 'apps-outline' },
]

export const ICONO_CONOCIDO: Record<string, string> = {
  productos: 'fast-food-outline',
  bebidas: 'cafe-outline',
  dulces: 'ice-cream-outline',
  otros: 'apps-outline',
  abarrotes: 'basket-outline',
  limpieza: 'home-outline',
}

/** Id determinista a partir del nombre (sin acentos, minúsculas, con guiones). */
export function slugCategoria(nombre: string): string {
  const limpio = nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return limpio || 'categoria'
}

/** Clave para comparar nombres sin acentos, mayúsculas ni espacios de sobra. */
export function claveCategoria(nombre: string): string {
  return nombre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

/** Icono por defecto para un nombre nuevo (los conocidos ya tienen el suyo). */
export function iconoDe(nombre: string): string {
  return ICONO_CONOCIDO[slugCategoria(nombre)] || ICONO_POR_DEFECTO
}

/** Normaliza y ordena (por `orden` y luego nombre). Compartido con el hook en vivo. */
export function ordenarCategorias(lista: Categoria[]): Categoria[] {
  return lista
    .map((c) => ({
      ...c,
      nombre: String(c.nombre || c.id || '').trim(),
      orden: Number.isFinite(Number(c.orden)) ? Number(c.orden) : 0,
      activo: c.activo !== false,
    }))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Categorías para los filtros: las administradas activas ∪ las que ya usan los productos. */
export function categoriasParaFiltros(administradas: Categoria[], presentes: Iterable<string>): string[] {
  // `activo !== false`: un documento sin el campo cuenta como activo (igual que
  // en `ordenarCategorias`), así no desaparece una categoría recién creada.
  const ordenadas = administradas.filter((c) => c.activo !== false).map((c) => c.nombre)
  const resto = [...new Set([...presentes].filter(Boolean))].filter((n) => !ordenadas.includes(n)).sort((a, b) => a.localeCompare(b, 'es'))
  return [...ordenadas, ...resto]
}
