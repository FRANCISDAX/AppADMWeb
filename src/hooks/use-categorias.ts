import { collection, onSnapshot } from 'firebase/firestore'
import * as React from 'react'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { asegurarCategoriasIniciales, ordenarCategorias, type Categoria } from '@/services/categorias'

/**
 * Categorías administradas, en vivo (si el admin las cambia, se reflejan al
 * instante en Inventario y PDV).
 *
 * Si la colección está **vacía** siembra una vez con las categorías que ya usan
 * los productos: como el formulario obliga a elegir de la lista, una colección
 * vacía dejaría sin categorías a la creación de productos.
 */
export function useCategorias() {
  const [categorias, setCategorias] = React.useState<Categoria[]>([])
  const [loading, setLoading] = React.useState(true)
  const sembrando = React.useRef(false)

  React.useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COL.CATEGORIAS),
      (snap) => {
        const lista = ordenarCategorias(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Categoria, 'id'>) })))
        setCategorias(lista)
        setLoading(false)
        if (lista.length === 0 && !sembrando.current) {
          sembrando.current = true
          asegurarCategoriasIniciales().catch((e) => console.error('❌ Siembra de categorías:', e))
        }
      },
      (err) => {
        console.error('❌ Error escuchando categorías:', err)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [])

  const activas = React.useMemo(() => categorias.filter((c) => c.activo), [categorias])

  /** Nombre de una categoría activa, o null si no existe / está desactivada. */
  const esActiva = React.useCallback((nombre: string) => activas.some((c) => c.nombre === nombre), [activas])

  return { categorias, activas, esActiva, loading }
}
