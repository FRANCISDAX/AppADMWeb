import { getCountFromServer, getDocs, limit, query, startAfter, type DocumentSnapshot, type Query } from 'firebase/firestore'
import * as React from 'react'

// Paginación REAL en Firestore: trae solo una página (limit + startAfter) y el
// total por agregación (getCountFromServer). Evita descargar toda la colección.
export function usePaginacionFirestore<T>({
  baseQuery,
  pageSize = 25,
  enabled = true,
}: {
  baseQuery: Query
  pageSize?: number
  enabled?: boolean
}) {
  const [items, setItems] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [pagina, setPagina] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const cursorsRef = React.useRef<DocumentSnapshot[]>([])

  // Reset cuando cambia la consulta base (mes, tipo, etc.).
  React.useEffect(() => {
    cursorsRef.current = []
    setPagina(0)
  }, [baseQuery])
  React.useEffect(() => {
    if (!enabled) return
    let activo = true
    // Solo muestra loading la primera vez; en recargas mantiene los items viejos
    // para evitar el parpadeo del spinner.
    if (items.length === 0) setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const cursor = pagina === 0 ? undefined : cursorsRef.current[pagina - 1]
        const q = cursor ? query(baseQuery, startAfter(cursor), limit(pageSize)) : query(baseQuery, limit(pageSize))
        const snap = await getDocs(q)
        if (!activo) return
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as T)))
        if (snap.docs.length > 0) cursorsRef.current[pagina] = snap.docs[snap.docs.length - 1]
        // Conteo total (agregación; no descarga los documentos).
        const countSnap = await getCountFromServer(baseQuery)
        if (!activo) return
        setTotal(countSnap.data().count)
      } catch (e) {
        if (activo) setError((e as Error).message)
      } finally {
        if (activo) setLoading(false)
      }
    })()
    return () => {
      activo = false
    }
  }, [baseQuery, pagina, pageSize, enabled, version])

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))

  return { items, total, pagina, totalPaginas, loading, error, setPagina, recargar: () => setVersion((v) => v + 1) }
}
