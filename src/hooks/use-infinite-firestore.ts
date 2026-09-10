import { useState, useCallback, useRef, useEffect } from 'react'
import { collection, getDocs, query, limit, startAfter, where, orderBy, type DocumentData, type QueryDocumentSnapshot, type QueryConstraint, type WhereFilterOp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

type UseInfiniteFirestoreOptions<T> = {
  pageSize?: number
  orderByField?: string
  orderByDirection?: 'asc' | 'desc'
  filters?: Array<{ field: string; op: '==' | '>' | '>=' | '<' | '<=' | 'in'; value: unknown }>
  transform?: (doc: QueryDocumentSnapshot<DocumentData>) => T
}

type UseInfiniteFirestoreReturn<T> = {
  items: T[]
  cargando: boolean
  cargandoMas: boolean
  hayMas: boolean
  total: number
  cargarMas: () => Promise<void>
  recargar: () => Promise<void>
}

export function useInfiniteFirestore<T = Record<string, unknown>>(
  collectionPath: string,
  options: UseInfiniteFirestoreOptions<T> = {}
): UseInfiniteFirestoreReturn<T> {
  const { pageSize = 25, orderByField = 'createdAt', orderByDirection = 'desc', filters = [], transform } = options

  const [items, setItems] = useState<T[]>([])
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [hayMas, setHayMas] = useState(true)
  const [total, setTotal] = useState(0)
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const mountedRef = useRef(true)

  const buildQuery = useCallback((afterDoc?: QueryDocumentSnapshot<DocumentData>) => {
    const constraints: QueryConstraint[] = []
    for (const f of filters) {
      constraints.push(where(f.field, f.op as WhereFilterOp, f.value))
    }
    if (orderByField !== 'createdAt') {
      constraints.push(orderBy(orderByField, orderByDirection))
    }
    constraints.push(limit(pageSize))
    if (afterDoc) constraints.push(startAfter(afterDoc))
    return query(collection(db, collectionPath), ...constraints)
  }, [collectionPath, pageSize, orderByField, orderByDirection, filters])

  const cargarPagina = useCallback(async (afterDoc?: QueryDocumentSnapshot<DocumentData>, append = false) => {
    try {
      const q = buildQuery(afterDoc)
      const snap = await getDocs(q)
      const nuevos = snap.docs.map((d) => (transform ? transform(d) : { id: d.id, ...d.data() } as T))

      if (!mountedRef.current) return

      if (append) {
        setItems((prev) => [...prev, ...nuevos])
      } else {
        setItems(nuevos)
      }

      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null
      setHayMas(snap.docs.length === pageSize)
      setTotal((prev) => append ? prev + nuevos.length : nuevos.length)
    } catch (e) {
      console.error('[useInfiniteFirestore] Error:', e)
    }
  }, [buildQuery, transform, pageSize])

  const cargarMas = useCallback(async () => {
    if (cargandoMas || !hayMas || !lastDocRef.current) return
    setCargandoMas(true)
    await cargarPagina(lastDocRef.current, true)
    if (mountedRef.current) setCargandoMas(false)
  }, [cargandoMas, hayMas, cargarPagina])

  const recargar = useCallback(async () => {
    setCargando(true)
    lastDocRef.current = null
    setHayMas(true)
    await cargarPagina()
    if (mountedRef.current) setCargando(false)
  }, [cargarPagina])

  useEffect(() => {
    mountedRef.current = true
    recargar()
    return () => { mountedRef.current = false }
  }, [recargar])

  return { items, cargando, cargandoMas, hayMas, total, cargarMas, recargar }
}
