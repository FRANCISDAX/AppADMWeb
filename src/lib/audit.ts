import { addDoc, collection, deleteDoc, getDocs, query, orderBy, where, limit as fsLimit, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { auth } from '@/lib/firebase'

const COL_AUDIT = 'tblAuditLog'

export type AuditLog = {
  id?: string
  usuario: string
  usuarioId: string | null
  accion: string
  entidad: string
  entidadId: string
  detalle: Record<string, unknown>
  timestamp: string
}

/**
 * Registra una entrada en el log de auditoría.
 * No lanza errores — si falla, solo advierte en consola.
 */
export async function logActividad({
  accion,
  entidad,
  entidadId,
  detalle = {},
}: {
  accion: string
  entidad: string
  entidadId: string
  detalle?: Record<string, unknown>
}): Promise<void> {
  try {
    const user = auth.currentUser
    await addDoc(collection(db, COL_AUDIT), {
      usuario: user?.displayName || user?.email || 'Sistema',
      usuarioId: user?.uid || null,
      accion,
      entidad,
      entidadId,
      detalle,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('⚠️ Audit log error:', e)
  }
}

/**
 * Obtiene los logs de auditoría, ordenados por timestamp descendente.
 */
export async function obtenerLogs(opts?: {
  desde?: string
  hasta?: string
  usuarioId?: string
  accion?: string
  maxResults?: number
}): Promise<AuditLog[]> {
  const constraints: QueryConstraint[] = [orderBy('timestamp', 'desc')]

  if (opts?.desde) constraints.push(where('timestamp', '>=', opts.desde))
  if (opts?.hasta) constraints.push(where('timestamp', '<=', opts.hasta))
  if (opts?.usuarioId) constraints.push(where('usuarioId', '==', opts.usuarioId))
  if (opts?.accion) constraints.push(where('accion', '==', opts.accion))
  if (opts?.maxResults) constraints.push(fsLimit(opts.maxResults))

  const q = query(collection(db, COL_AUDIT), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog))
}

/**
 * Elimina registros de auditoría más antiguos que `dias` días.
 * Retorna la cantidad de registros eliminados.
 */
export async function limpiarLogs(dias: number = 90): Promise<number> {
  const fechaCorte = new Date()
  fechaCorte.setDate(fechaCorte.getDate() - dias)
  const corteISO = fechaCorte.toISOString()

  const q = query(collection(db, COL_AUDIT), where('timestamp', '<', corteISO), orderBy('timestamp', 'asc'))
  const snap = await getDocs(q)

  let eliminados = 0
  for (const docSnap of snap.docs) {
    await deleteDoc(docSnap.ref)
    eliminados++
  }
  return eliminados
}

/**
 * Exporta logs a formato CSV (retorna string).
 */
export function logsToCSV(logs: AuditLog[]): string {
  const header = 'Fecha,Hora,Usuario,Acción,Entidad,ID Documento,Detalle'
  const rows = logs.map((l) => {
    const fecha = l.timestamp ? new Date(l.timestamp).toLocaleDateString('es-PE') : ''
    const hora = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('es-PE') : ''
    const detalle = l.detalle ? JSON.stringify(l.detalle).replace(/"/g, '""') : ''
    return `"${fecha}","${hora}","${l.usuario}","${l.accion}","${l.entidad}","${l.entidadId}","${detalle}"`
  })
  return [header, ...rows].join('\n')
}

/**
 * Dispara descarga de un archivo TXT/CSV en el navegador.
 */
export function descargarArchivo(contenido: string, nombreArchivo: string, mimeType = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob(['\uFEFF' + contenido], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombreArchivo
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Obtiene la lista de acciones únicas registradas.
 */
export async function obtenerAcciones(): Promise<string[]> {
  const snap = await getDocs(collection(db, COL_AUDIT))
  const acciones = new Set<string>()
  snap.docs.forEach((d) => {
    const data = d.data()
    if (data.accion) acciones.add(data.accion as string)
  })
  return [...acciones].sort()
}
