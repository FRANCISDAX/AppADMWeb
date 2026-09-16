import { collection, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where, writeBatch, limit, startAfter, type QueryDocumentSnapshot, type DocumentData, type QueryConstraint } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { consultarDni, consultarRuc } from '@/lib/consultaSunat'

// Port de helper/ClientesHelper.js de la app RN (misma lógica; sin testMode).
export type Cliente = {
  id?: string
  tipoDoc?: string
  numeroDoc?: string
  razonSocial?: string
  razonSocialLower?: string
  direccion?: string
  email?: string
  telefono?: string
  fechaRegistro?: string
  ultimaCompra?: string | null
  totalCompras?: number
  montoTotal?: number
  frecuencia?: string
  tipoDocDefecto?: string
  listaPrecio?: string
  creditoActivo?: boolean
  limiteCredito?: number
  diasCredito?: number
  saldoPendiente?: number
  bloqueado?: boolean
  notas?: string
  sunatValido?: boolean
  sunatEstado?: string
  nombre?: string
  descuentoPorcentaje?: number
  [key: string]: unknown
}

const sanitizeString = (v: any, max: number) => String(v ?? '').trim().slice(0, max)
const sanitizeNumber = (v: any, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0))

export async function crearOCargarCliente(numeroDoc: string): Promise<{ success: boolean; cliente?: Cliente; creado?: boolean; error?: string }> {
  try {
    const id = numeroDoc.trim()
    const ref = doc(db, COL.CLIENTES, id)
    const snap = await getDoc(ref)
    if (snap.exists()) return { success: true, cliente: { id: snap.id, ...snap.data() as Cliente }, creado: false }
    const esRuc = id.length === 11
    let data: any
    if (esRuc) data = await consultarRuc(id)
    else data = await consultarDni(id)
    const razonSocial = sanitizeString(
      data?.nombre || data?.razonSocial || data?.razon_social || (esRuc ? '-' : data?.nombres ? `${data.nombres} ${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim() : '-'),
      200
    )
    const cliente: Cliente = {
      id,
      tipoDoc: esRuc ? 'ruc' : 'dni',
      numeroDoc: id,
      razonSocial,
      razonSocialLower: razonSocial.toLowerCase(),
      direccion: sanitizeString(data?.direccion || data?.direccion_completa || '', 300),
      email: '',
      telefono: '',
      fechaRegistro: new Date().toISOString(),
      ultimaCompra: null,
      totalCompras: 0,
      frecuencia: 'ocasional',
      tipoDocDefecto: esRuc ? 'factura' : 'boleta',
      listaPrecio: 'general',
      creditoActivo: false,
      limiteCredito: 0,
      diasCredito: 0,
      saldoPendiente: 0,
      bloqueado: false,
      notas: '',
      sunatValido: !!data,
      sunatEstado: 'ACTIVO',
    }
    await setDoc(ref, cliente)
    return { success: true, cliente, creado: true }
  } catch (e) {
    console.error('❌ Error al crear/cargar cliente:', e)
    return { success: false, error: (e as Error).message }
  }
}

export async function buscarClientes(queryText: string): Promise<Cliente[]> {
  try {
    const q = queryText.trim()
    const qLower = q.toLowerCase()
    if (!q) return []
    const results: Cliente[] = []
    // 1) Exacto por número de documento (id del doc).
    const exactSnap = await getDoc(doc(db, COL.CLIENTES, q))
    if (exactSnap.exists()) results.push({ id: exactSnap.id, ...exactSnap.data() as Cliente })

    // 2) Búsqueda por SUB-CADENA (cualquier parte del nombre o del documento).
    //    Firestore no soporta "contains" en queries; para una base de clientes
    //    pequeña se trae la colección y se filtra en el cliente (máx 20).
    const snap = await getDocs(collection(db, COL.CLIENTES))
    snap.forEach((d) => {
      if (results.length >= 20) return
      const c = d.data() as any
      const inNombre = (c.razonSocialLower || '').includes(qLower)
      const inDoc = (c.numeroDoc || '').includes(q)
      if ((inNombre || inDoc) && !results.find((r) => r.id === d.id)) {
        results.push({ id: d.id, ...c as Cliente })
      }
    })

    return results.slice(0, 20)
  } catch (e) {
    console.error('❌ Error al buscar clientes:', e)
    return []
  }
}

export async function obtenerClientesConDeuda(): Promise<Cliente[]> {
  try {
    // Intento con query Firestore (requiere índice en saldoPendiente)
    try {
      const snap = await getDocs(query(collection(db, COL.CLIENTES), where('saldoPendiente', '>', 0)))
      const results: Cliente[] = []
      snap.forEach((d) => results.push({ id: d.id, ...d.data() as Cliente }))
      if (results.length > 0) return results.sort((a, b) => (b.saldoPendiente ?? 0) - (a.saldoPendiente ?? 0))
    } catch {
      // Si falla el query (índice faltante), uso fallback
    }
    // Fallback: traer todos y filtrar en cliente
    const snap = await getDocs(collection(db, COL.CLIENTES))
    const results: Cliente[] = []
    snap.forEach((d) => {
      const c = { id: d.id, ...d.data() as Cliente }
      if ((c.saldoPendiente ?? 0) > 0) results.push(c)
    })
    return results.sort((a, b) => (b.saldoPendiente ?? 0) - (a.saldoPendiente ?? 0))
  } catch (e) {
    console.error('❌ Error al obtener clientes con deuda:', e)
    return []
  }
}

export async function obtenerTodosLosClientes(): Promise<Cliente[]> {
  try {
    const snap = await getDocs(collection(db, COL.CLIENTES))
    const results: Cliente[] = []
    snap.forEach((d) => results.push({ id: d.id, ...d.data() as Cliente }))
    return results
  } catch (e) {
    console.error('❌ Error al obtener todos los clientes:', e)
    return []
  }
}

export async function cargarClientesPagina(
  pageSize: number,
  afterDoc?: QueryDocumentSnapshot<DocumentData>,
  filtro?: { soloConDeuda?: boolean; ordenarPor?: 'razonSocial' | 'saldoPendiente' | 'ultimaCompra' },
): Promise<{ clientes: Cliente[]; ultimoDoc: QueryDocumentSnapshot<DocumentData> | null; hayMas: boolean }> {
  try {
    const constraints: QueryConstraint[] = []
    if (filtro?.soloConDeuda) constraints.push(where('saldoPendiente', '>', 0))
    if (filtro?.ordenarPor === 'saldoPendiente' && !filtro?.soloConDeuda) {
      constraints.push(where('saldoPendiente', '>', 0))
    }
    constraints.push(limit(pageSize))
    if (afterDoc) constraints.push(startAfter(afterDoc))
    const snap = await getDocs(query(collection(db, COL.CLIENTES), ...constraints))
    const clientes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente))
    const ultimoDoc = snap.docs[snap.docs.length - 1] ?? null
    const hayMas = snap.docs.length === pageSize
    return { clientes, ultimoDoc, hayMas }
  } catch {
    // Fallback sin where si falta índice
    const constraints: QueryConstraint[] = [limit(pageSize)]
    if (afterDoc) constraints.push(startAfter(afterDoc))
    const snap = await getDocs(query(collection(db, COL.CLIENTES), ...constraints))
    const clientes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente))
    const ultimoDoc = snap.docs[snap.docs.length - 1] ?? null
    const hayMas = snap.docs.length === pageSize
    return { clientes, ultimoDoc, hayMas }
  }
}

export async function obtenerCliente(id: string): Promise<Cliente | null> {
  try {
    const snap = await getDoc(doc(db, COL.CLIENTES, id))
    return snap.exists() ? ({ id: snap.id, ...snap.data() as Cliente }) : null
  } catch (e) {
    console.error('❌ Error al obtener cliente:', e)
    return null
  }
}

export async function actualizarCliente(id: string, data: Partial<Cliente>): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = {
      razonSocial: sanitizeString(data.razonSocial, 200),
      direccion: sanitizeString(data.direccion, 300),
      email: sanitizeString(data.email, 100),
      telefono: sanitizeString(data.telefono, 20),
      notas: sanitizeString(data.notas, 500),
      creditoActivo: !!data.creditoActivo,
      limiteCredito: sanitizeNumber(data.limiteCredito, 0, 999999),
      diasCredito: sanitizeNumber(data.diasCredito, 0, 999),
      descuentoPorcentaje: sanitizeNumber(data.descuentoPorcentaje ?? 0, 0, 100),
      updatedAt: new Date().toISOString(),
    }
    if (data.razonSocial && data.razonSocial.trim()) updateData.razonSocialLower = (updateData.razonSocial as string).toLowerCase()
    await updateDoc(doc(db, COL.CLIENTES, id), updateData)
    return { success: true }
  } catch (e) {
    console.error('❌ Error al actualizar cliente:', e)
    return { success: false, error: (e as Error).message }
  }
}

// Calcula el saldo pendiente real del cliente (crédito) a partir de sus documentos. No escribe.
export async function calcularSaldoCredito(clienteId: string): Promise<number> {
  const docsSnap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('venta.cliente_dni', '==', clienteId)))
  let saldo = 0
  const detalle: { id: string; total: number; cobrado: number; pendiente: number; pagado?: boolean }[] = []
  docsSnap.forEach((d) => {
    const v = d.data().venta || {}
    if (v.tipoPago === 'credito') {
      const total = v.total || 0
      const cobrado = v.cobrado || 0
      const pendiente = total - cobrado
      saldo += pendiente
      detalle.push({ id: d.id, total, cobrado, pendiente, pagado: v.pagado })
    }
  })
  console.log('[calcularSaldoCredito] clienteId:', clienteId)
  console.table(detalle)
  console.log('[calcularSaldoCredito] saldo total:', saldo)
  return saldo
}

export async function corregirCobrosExcedidos(clienteId: string): Promise<{ corregidos: number; total: number }> {
  const docsSnap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('venta.cliente_dni', '==', clienteId)))
  let corregidos = 0
  let total = 0
  const batch = writeBatch(db)
  docsSnap.forEach((d) => {
    const v = d.data().venta || {}
    if (v.tipoPago === 'credito') {
      total++
      const cobrado = v.cobrado || 0
      const t = v.total || 0
      if (cobrado > t) {
        batch.update(doc(db, COL.DOCUMENTOS, d.id), {
          'venta.cobrado': t,
          'venta.pagado': true,
        })
        corregidos++
      }
    }
  })
  if (corregidos > 0) await batch.commit()
  return { corregidos, total }
}

export async function actualizarSaldoCredito(clienteId: string): Promise<{ success: boolean; saldo?: number; error?: string }> {
  const ref = doc(db, COL.CLIENTES, clienteId)
  try {
    const saldo = await calcularSaldoCredito(clienteId)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Cliente no encontrado')
      tx.update(ref, { saldoPendiente: saldo, updatedAt: new Date().toISOString() })
    })
    return { success: true, saldo }
  } catch (e) {
    console.error('❌ Error al actualizar saldo crédito:', e)
    return { success: false, error: (e as Error).message }
  }
}

export async function registrarCobro(documentoId: string, monto: number, tipoPago: string = 'efectivo', turnoId?: string, operacion?: string): Promise<{ success: boolean; error?: string }> {
  const ref = doc(db, COL.DOCUMENTOS, documentoId)
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Documento no encontrado')

      // Leer turno ANTES de cualquier escritura (Firestore: todos los reads primero).
      let turnoSnap: any = null
      if (turnoId) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        turnoSnap = await tx.get(turnoRef)
        if (!turnoSnap.exists() || turnoSnap.data().estado !== 'abierto') throw new Error('El turno ya no está abierto. Abrí un turno antes de cobrar.')
      }

      const venta = snap.data().venta || {}
      const nuevoCobrado = (venta.cobrado || 0) + monto
      const total = venta.total || 0
      const pago: Record<string, unknown> = { monto, tipoPago, fecha: new Date().toISOString() }
      if (operacion) pago.operacion = operacion
      const pagos = [...(Array.isArray(venta.pagos) ? venta.pagos : []), pago]
      tx.set(ref, {
        venta: { ...venta, cobrado: nuevoCobrado, cobradoFecha: pago.fecha, pagos },
        ...(nuevoCobrado >= total ? { pagado: true } : {}),
      }, { merge: true })

      if (turnoId && turnoSnap) {
        const turnoRef = doc(db, COL.TURNOS, turnoId)
        const t = turnoSnap.data()
        const item = {
          tipo: 'cobro_credito',
          id: documentoId,
          monto,
          total: monto,
          tipoPago,
          operacion: operacion || 'SN',
          fecha: new Date().toISOString(),
          serie_numero: `COBRO-${documentoId}`,
        }
        const totalEfectivo = (t.totalEfectivo || 0) + (tipoPago === 'efectivo' ? monto : 0)
        const totalTransferencia = (t.totalTransferencia || 0) + (tipoPago === 'transferencia' ? monto : 0)
        tx.update(turnoRef, {
          ventasDelTurno: [...(t.ventasDelTurno || []), item],
          totalEfectivo,
          totalTransferencia,
        })
      }
    })
    return { success: true }
  } catch (e) {
    console.error('❌ Error al registrar cobro:', e)
    return { success: false, error: (e as Error).message }
  }
}

export async function obtenerVentasDelCliente(clienteId: string, limite = 20, usuarioFiltro?: string): Promise<any[]> {
  try {
    const snapshot = await getDocs(query(collection(db, COL.DOCUMENTOS), where('venta.cliente_dni', '==', clienteId), ...(usuarioFiltro ? [where('usuarioId', '==', usuarioFiltro)] : [])))
    const docs: any[] = []
    snapshot.forEach((d) => docs.push({ id: d.id, ...d.data() }))
    return docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, limite)
  } catch (e) {
    console.error('❌ Error al obtener ventas del cliente:', e)
    return []
  }
}

export async function validarSunatCliente(id: string): Promise<{ valido: boolean; estado: string } | null> {
  try {
    const snap = await getDoc(doc(db, COL.CLIENTES, id))
    if (!snap.exists()) return null
    const d = snap.data()
    const data = d.tipoDoc === 'ruc' ? await consultarRuc(id) : await consultarDni(id)
    const valido = !!data
    const estado = data?.estado || (valido ? 'ACTIVO' : 'NO ENCONTRADO')
    await updateDoc(doc(db, COL.CLIENTES, id), { sunatValido: valido, sunatEstado: estado, updatedAt: new Date().toISOString() })
    return { valido, estado }
  } catch (e) {
    console.error('❌ Error al validar cliente en SUNAT:', e)
    return null
  }
}
