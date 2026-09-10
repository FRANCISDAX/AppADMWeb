import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import type { Cliente } from '@/services/clientes'

export type RFMResultado = {
  clienteId: string
  nombre: string
  recencia: number
  frecuencia: number
  monetario: number
  clasificacion: 'VIP' | 'Frecuente' | 'Ocasional' | 'En riesgo'
  scoreR: number
  scoreF: number
  scoreM: number
}

function calcularRecencia(ultimaCompra: string | null): number {
  if (!ultimaCompra) return 999
  const hoy = new Date()
  const ultima = new Date(ultimaCompra)
  const diffMs = hoy.getTime() - ultima.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function asignarScore(valor: number, umbrales: number[]): number {
  // Umbral más bajo = mejor score
  if (valor <= umbrales[0]) return 5
  if (valor <= umbrales[1]) return 4
  if (valor <= umbrales[2]) return 3
  if (valor <= umbrales[3]) return 2
  return 1
}

function asignarScoreMonetario(valor: number, umbrales: number[]): number {
  // Umbral más alto = mejor score
  if (valor >= umbrales[0]) return 5
  if (valor >= umbrales[1]) return 4
  if (valor >= umbrales[2]) return 3
  if (valor >= umbrales[3]) return 2
  return 1
}

function clasificarCliente(scoreR: number, scoreF: number, scoreM: number): 'VIP' | 'Frecuente' | 'Ocasional' | 'En riesgo' {
  const total = scoreR + scoreF + scoreM
  if (total >= 12) return 'VIP'
  if (total >= 9) return 'Frecuente'
  if (total >= 6) return 'Ocasional'
  return 'En riesgo'
}

export async function calcularRFM(clientes?: Cliente[]): Promise<RFMResultado[]> {
  let listaClientes = clientes
  if (!listaClientes) {
    const snap = await getDocs(collection(db, COL.CLIENTES))
    listaClientes = []
    snap.forEach((d) => listaClientes!.push({ id: d.id, ...d.data() as Cliente }))
  }

  // Obtener todas las ventas
  const ventasSnap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('venta.total', '>', 0)))
  const ventasPorCliente: Record<string, { total: number; fecha: string; cantidad: number }> = {}

  ventasSnap.forEach((d) => {
    const v = d.data().venta
    if (!v?.cliente_dni) return
    const clienteId = v.cliente_dni
    if (!ventasPorCliente[clienteId]) {
      ventasPorCliente[clienteId] = { total: 0, fecha: '', cantidad: 0 }
    }
    ventasPorCliente[clienteId].total += v.total || 0
    ventasPorCliente[clienteId].cantidad += 1
    const fechaVenta = v.fecha || d.data().createdAt || ''
    if (fechaVenta > ventasPorCliente[clienteId].fecha) {
      ventasPorCliente[clienteId].fecha = fechaVenta
    }
  })

  // Calcular RFM para cada cliente
  const resultados: RFMResultado[] = []

  for (const cliente of listaClientes!) {
    const clienteId = cliente.id!
    const ventas = ventasPorCliente[clienteId] || { total: 0, fecha: '', cantidad: 0 }
    const recencia = calcularRecencia(ventas.fecha || null)

    // Umbrales para Recencia (días) - menor es mejor
    const umbralR = [7, 30, 60, 120]
    // Umbrales para Frecuencia (# compras) - mayor es mejor
    const umbralF = [20, 10, 5, 2]
    // Umbrales para Monetario (S/) - mayor es mejor
    const umbralM = [5000, 2000, 800, 200]

    const scoreR = asignarScore(recencia, umbralR)
    const scoreF = ventas.cantidad > 0 ? asignarScoreMonetario(ventas.cantidad, umbralF) : 1
    const scoreM = ventas.total > 0 ? asignarScoreMonetario(ventas.total, umbralM) : 1

    resultados.push({
      clienteId,
      nombre: cliente.razonSocial || clienteId,
      recencia,
      frecuencia: ventas.cantidad,
      monetario: ventas.total,
      clasificacion: clasificarCliente(scoreR, scoreF, scoreM),
      scoreR,
      scoreF,
      scoreM,
    })
  }

  return resultados.sort((a, b) => (b.scoreR + b.scoreF + b.scoreM) - (a.scoreR + a.scoreF + a.scoreM))
}

export async function actualizarClasificacionesRFM(): Promise<{ actualizados: number; resultados: RFMResultado[] }> {
  const resultados = await calcularRFM()
  const batch = writeBatch(db)

  for (const r of resultados) {
    const ref = doc(db, COL.CLIENTES, r.clienteId)
    batch.update(ref, {
      frecuencia: r.clasificacion,
      rfmRecencia: r.recencia,
      rfmFrecuencia: r.frecuencia,
      rfmMonetario: r.monetario,
      rfmScoreR: r.scoreR,
      rfmScoreF: r.scoreF,
      rfmScoreM: r.scoreM,
      rfmActualizado: new Date().toISOString(),
    })
  }

  await batch.commit()
  return { actualizados: resultados.length, resultados }
}

export function obtenerColorClasificacion(clasificacion: string): string {
  switch (clasificacion) {
    case 'VIP': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400'
    case 'Frecuente': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
    case 'Ocasional': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
    case 'En riesgo': return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400'
  }
}

export function obtenerIconoClasificacion(clasificacion: string): string {
  switch (clasificacion) {
    case 'VIP': return '👑'
    case 'Frecuente': return '🔥'
    case 'Ocasional': return '👤'
    case 'En riesgo': return '⚠️'
    default: return '👤'
  }
}
