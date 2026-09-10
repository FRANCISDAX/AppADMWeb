import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import type { Producto } from '@/hooks/use-productos'

// Port de services/kardex.js de la app RN.
const esEntrada = (tipo: string) =>
  ['compra', 'ajuste_entrada', 'inventario_fisico_entrada', 'anulacion_venta', 'nota_credito'].includes(tipo)

export async function cargarProductos(): Promise<Producto[]> {
  const snap = await getDocs(query(collection(db, COL.PRODUCTOS), orderBy('nombre', 'asc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Producto, 'id'>) }))
}

export async function consultarKardex(producto: Producto, fechaDesde: Date, fechaHasta: Date) {
  const desdeISO = new Date(fechaDesde)
  desdeISO.setHours(0, 0, 0, 0)
  const hastaISO = new Date(fechaHasta)
  hastaISO.setHours(23, 59, 59, 999)

  const snap = await getDocs(
    query(collection(db, COL.MOVIMIENTOS), where('productoId', '==', producto.id), where('fecha', '>=', desdeISO.toISOString()), where('fecha', '<=', hastaISO.toISOString()))
  )

  const movimientos: any[] = []
  snap.forEach((doc) => {
    const d = doc.data()
    if (d.tipoMovimiento !== 'anulacion_compra') movimientos.push({ id: doc.id, ...d })
  })
  movimientos.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())

  const entrada = movimientos.filter((m) => esEntrada(m.tipoMovimiento)).reduce((s, m) => s + (m.cantidad || 0), 0)
  const salida = movimientos.filter((m) => !esEntrada(m.tipoMovimiento)).reduce((s, m) => s + (m.cantidad || 0), 0)

  const stockInicial = movimientos.length > 0 ? movimientos[0].stockAnterior ?? 0 : 0

  let running = stockInicial
  const filas = movimientos.map((m) => {
    const esEnt = esEntrada(m.tipoMovimiento)
    running = esEnt ? running + (m.cantidad || 0) : running - (m.cantidad || 0)
    return { ...m, cantidadReal: esEnt ? m.cantidad : -m.cantidad, stockCorriente: running }
  })

  return { producto, stockInicial, stockFinal: running, totalEntradas: entrada, totalSalidas: salida, filas }
}
