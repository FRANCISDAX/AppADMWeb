import { collection, getDocs, query, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

const TIPOS_VENTA = ['NV', 'BOLETA', 'FACTURA']
const fmt2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type Item = { id?: string; nombre?: string; cantidad?: number; precioVenta?: number; subtotal?: number }
type VentasDoc = { id: string; tipoDoc?: string; serieNumero?: string; fecha?: string; createdAt?: string; estado?: string; consolidado?: boolean; venta?: { total?: number; tipoPago?: string; cobrado?: number; cliente_dni?: string; cliente_nombre?: string; items?: Item[]; pagos?: { tipo?: string; monto?: number }[] } }

export type AnalisisMes = {
  kpis: { totalVentas: number; numTransacciones: number; ticketPromedio: number; margenBruto: number; topCategoria: string; porcCredito: number }
  ventasPorDia: { dia: string; total: number; transacciones: number }[]
  porTipoPago: { tipo: string; total: number }[]
  porTipoDoc: { tipo: string; count: number; total: number }[]
  topProductos: { nombre: string; codigo: string; cantidad: number; ingreso: number; costo: number; margen: number; margenPct: number }[]
  utilidadProductos: { nombre: string; codigo: string; cantidad: number; ingreso: number; costo: number; margen: number; margenPct: number }[]
  topClientes: { nombre: string; dni: string; total: number; numVentas: number }[]
  morosidad: { nombre: string; dni: string; saldo: number }[]
  stockBajo: { nombre: string; codigo: string; stock: number; minStock: number }[]
  agotados: number
  valorizacionPorCategoria: { categoria: string; valor: number }[]
  totalValorizacion: number
}

export async function obtenerAnalisisMes(anio: number, mes: number): Promise<AnalisisMes> {
  const ini = new Date(anio, mes - 1, 1)
  const fin = new Date(anio, mes, 0, 23, 59, 59, 999)

  const [docsSnap, prodsSnap] = await Promise.all([
    getDocs(query(collection(db, COL.DOCUMENTOS), where('fecha', '>=', ini.toISOString()), where('fecha', '<=', fin.toISOString()))),
    getDocs(collection(db, COL.PRODUCTOS)),
  ])

  const productos = new Map<string, any>()
  prodsSnap.forEach((d) => productos.set(d.id, { id: d.id, ...(d.data() as any) }))

  const ventas: VentasDoc[] = []
  docsSnap.forEach((d) => {
    const docData = d.data() as any
    const tipoDoc = docData.tipoDoc || docData.tipo
    if (!TIPOS_VENTA.includes(tipoDoc)) return
    if (docData.estado === 'anulada') return
    if (docData.consolidado) return
    ventas.push({ id: d.id, ...docData, tipoDoc })
  })

  let totalVentas = 0
  let numTransacciones = ventas.length
  let totalCredito = 0
  let margenBruto = 0
  let topCategoria = ''
  const dias: Record<string, { total: number; transacciones: number }> = {}
  const porTipoPago: Record<string, number> = {}
  const porTipoDoc: Record<string, { count: number; total: number }> = {}
  const porProd: Record<string, { nombre: string; codigo: string; cantidad: number; ingreso: number; categoria: string }> = {}
  const porCliente: Record<string, { nombre: string; total: number; numVentas: number }> = {}
  const morosidad: Record<string, { nombre: string; saldo: number }> = {}
  const porCat: Record<string, number> = {}

  for (const v of ventas) {
    const ven = v.venta || {}
    const total = Number(ven.total) || 0
    totalVentas += total
    const tipoPago = ven.tipoPago || 'efectivo'
    // Reparto por pagos (pago mixto) si existe; si no, todo al tipoPago.
    const pagos = Array.isArray(ven.pagos) && ven.pagos.length > 0 ? ven.pagos : [{ tipo: tipoPago, monto: total }]
    for (const p of pagos) {
      const pt = p.tipo || 'efectivo'
      porTipoPago[pt] = (porTipoPago[pt] || 0) + (Number(p.monto) || 0)
      if (pt === 'credito') totalCredito += Number(p.monto) || 0
    }
    if (tipoPago === 'credito') totalCredito = Math.max(totalCredito, porTipoPago['credito'] || 0)

    const td = (v.tipoDoc || 'NV') as string
    if (!porTipoDoc[td]) porTipoDoc[td] = { count: 0, total: 0 }
    porTipoDoc[td].count++
    porTipoDoc[td].total += total

    // Por día (fecha local)
    const f = new Date(v.fecha || v.createdAt || '')
    const key = String(f.getDate()).padStart(2, '0')
    if (!dias[key]) dias[key] = { total: 0, transacciones: 0 }
    dias[key].total += total
    dias[key].transacciones++

    // Cliente
    const dni = ven.cliente_dni || 'CONSUMIDOR'
    const cliNombre = ven.cliente_nombre && ven.cliente_nombre !== '-' ? ven.cliente_nombre : 'Consumidor'
    const cliKey = dni || cliNombre
    if (!porCliente[cliKey]) porCliente[cliKey] = { nombre: cliNombre, total: 0, numVentas: 0 }
    porCliente[cliKey].total += total
    porCliente[cliKey].numVentas++

    // Crédito pendiente (morosidad)
    if (tipoPago === 'credito') {
      const pend = total - (Number(ven.cobrado) || 0)
      if (pend > 0) {
        const mk = cliKey
        if (!morosidad[mk]) morosidad[mk] = { nombre: cliNombre, saldo: 0 }
        morosidad[mk].saldo += pend
      }
    }

    // Items → margen / top productos / categoría
    for (const it of ven.items || []) {
      const pid = String(it.id || '')
      const cat = (it as any).categoria || productos.get(pid)?.categoria || 'General'
      const nombre = it.nombre || productos.get(pid)?.nombre || pid
      const codigo = productos.get(pid)?.codigo || (pid as string)
      const cant = Number(it.cantidad) || 0
      const precioVenta = Number(it.precioVenta) || 0
      const ingresoT = fmt2(precioVenta * cant)
      if (!porProd[pid]) porProd[pid] = { nombre, codigo, cantidad: 0, ingreso: 0, categoria: cat }
      porProd[pid].cantidad += cant
      porProd[pid].ingreso += ingresoT
      if (!cat) porCat[cat] = 0
      porCat[cat] = (porCat[cat] || 0) + ingresoT
      const costo = Number(productos.get(pid)?.precioCompra) || 0
      margenBruto += fmt2((precioVenta - costo) * cant)
    }
  }

  // Por tipo doc sorted by total desc
  const porTipoDocArr = Object.entries(porTipoDoc).map(([tipo, o]) => ({ tipo, ...o })).sort((a, b) => b.total - a.total)

  // Productos: margen y margen%
  const allProductos = Object.entries(porProd)
    .map(([pid, o]) => {
      const costo = (Number(productos.get(pid)?.precioCompra) || 0) * o.cantidad
      const margen = fmt2(o.ingreso - costo)
      const margenPct = o.ingreso > 0 ? fmt2((margen / o.ingreso) * 100) : 0
      return { nombre: o.nombre || pid, codigo: o.codigo || pid, cantidad: o.cantidad, ingreso: fmt2(o.ingreso), costo: fmt2(costo), margen, margenPct }
    })
  const topProductos = allProductos.sort((a, b) => b.ingreso - a.ingreso).slice(0, 10)
  const utilidadProductos = allProductos.sort((a, b) => b.margen - a.margen)

  // Top categoría
  const topCatEntry = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0]
  topCategoria = topCatEntry ? topCatEntry[0] : '-'

  // Clientes top + morosidad
  const topClientes = Object.entries(porCliente).map(([k, o]) => ({ dni: k, ...o })).sort((a, b) => b.total - a.total).slice(0, 10)
  const morosidadArr = Object.entries(porCliente).map(([k, o]) => {
    const m = morosidad[k]
    return { nombre: o.nombre, dni: k, saldo: m ? fmt2(m.saldo) : 0 }
  }).filter((m) => m.saldo > 0).sort((a, b) => b.saldo - a.saldo)

  // Stock
  const stockBajo: any[] = []
  let agotados = 0
  let totalValorizacion = 0
  const valCat: Record<string, number> = {}
  prodsSnap.forEach((d) => {
    const p = d.data() as any
    if (p.activo === false) return
    const stock = Number(p.stock) || 0
    const costo = Number(p.precioCompra) || 0
    const cat = p.categoria || 'General'
    totalValorizacion += stock * costo
    valCat[cat] = (valCat[cat] || 0) + stock * costo
    if (stock === 0) agotados++
    else if (stock <= (Number(p.minStock) || 0)) stockBajo.push({ nombre: p.nombre || d.id, codigo: p.codigo || d.id, stock, minStock: Number(p.minStock) || 0 })
  })
  const stockBajoArr = stockBajo.sort((a, b) => a.stock - b.stock).slice(0, 20)
  const valorizacionPorCategoria = Object.entries(valCat).map(([categoria, valor]) => ({ categoria, valor: fmt2(valor) })).sort((a, b) => b.valor - a.valor)

  const ventasPorDia = Object.entries(dias).map(([dia, o]) => ({ dia, total: fmt2(o.total), transacciones: o.transacciones })).sort((a, b) => a.dia.localeCompare(b.dia))

  return {
    kpis: {
      totalVentas: fmt2(totalVentas),
      numTransacciones,
      ticketPromedio: fmt2(numTransacciones > 0 ? totalVentas / numTransacciones : 0),
      margenBruto: fmt2(margenBruto),
      topCategoria,
      porcCredito: fmt2(totalVentas > 0 ? (totalCredito / totalVentas) * 100 : 0),
    },
    ventasPorDia,
    porTipoPago: Object.entries(porTipoPago).map(([tipo, total]) => ({ tipo, total: fmt2(total) })),
    porTipoDoc: porTipoDocArr,
    topProductos,
    utilidadProductos,
    topClientes,
    morosidad: morosidadArr,
    stockBajo: stockBajoArr,
    agotados,
    valorizacionPorCategoria,
    totalValorizacion: fmt2(totalValorizacion),
  }
}
