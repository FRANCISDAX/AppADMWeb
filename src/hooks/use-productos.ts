import { collection, onSnapshot } from 'firebase/firestore'
import * as React from 'react'
import { db } from '@/lib/firebase'

export type KitItem = {
  productoId: string
  cantidad: number
}

export type Producto = {
  id: string
  nombre?: string
  codigo?: string
  categoria?: string
  precioVenta?: number
  precioCompra?: number
  precioEspecial?: number
  stock?: number
  minStock?: number
  activo?: boolean
  aliasVoz?: string
  imagen?: string
  unidadBase?: string
  tipoAfectacion?: string
  fechaVencimiento?: string
  isKit?: boolean
  kitItems?: KitItem[]
  presentaciones?: { id?: string; nombre?: string; factor?: number; esVenta?: boolean; esCompra?: boolean }[]
}

export function useProductos() {
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'tblProductos'),
      (snap) => {
        const lista: Producto[] = []
        snap.forEach((doc) => lista.push({ id: doc.id, ...(doc.data() as Omit<Producto, 'id'>) }))
        setProductos(lista)
        setLoading(false)
      },
      (err) => {
        console.error('❌ Error cargando productos:', err)
        setError(
          'No se pudieron cargar los productos. Publicá las reglas de Firestore (Firestore → Rules) permitiendo lectura autenticada, ej: allow read: if request.auth != null.'
        )
        setLoading(false)
      }
    )
    return unsubscribe
  }, [])

  return { productos, loading, error }
}
