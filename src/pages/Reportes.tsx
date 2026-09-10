import { CloudUpload, Download, FileText, Loader2, Printer, Receipt, Send, Trash2, Wallet } from 'lucide-react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { usePaginacionFirestore } from '@/hooks/use-paginacion-firestore'
import { abrirPDFComprobante } from '@/lib/pdf'
import { exportarExcel } from '@/lib/excel'
import { useNotifications } from '@/components/notifications'
import { enviarDocumentoASunat, enviarNotaASunat } from '@/services/sunat'
import { anularNotaVenta } from '@/services/ventas'
import { corregirTipoPago } from '@/services/reportes'
import { TIPOS_NOTA_SUNAT } from '@/constants/tributario'
import { crearNotaCreditoDebito } from '@/services/notas'
import { buscarTurnoAbierto } from '@/services/turnos'
import { generarConsolidado } from '@/services/consolidado'
import { ListaPaginada } from '@/components/ListaPaginada'
import { PaginadorControles } from '@/components/PaginadorControles'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)
const PAGE = 25

const SUNAT_TIPOS = [
  { key: 'BOLETA', label: 'Boletas', color: '#FF9800' },
  { key: 'FACTURA', label: 'Facturas', color: '#4CAF50' },
  { key: 'NC', label: 'Notas Crédito', color: '#FF9800' },
  { key: 'ND', label: 'Notas Débito', color: '#E91E63' },
] as const

type Doc = {
  id: string
  tipoDoc?: string
  serie?: string
  numero?: number
  serieNumero?: string
  anioMes?: string
  fecha?: string
  createdAt?: string
  estado?: string
  venta?: { total?: number; cliente_nombre?: string; cliente_dni?: string; tipoPago?: string; items?: any[]; fecha?: string; referencia?: string; cajero?: string }
  sunat?: { estado?: string; consolidado?: boolean; cdrCode?: number; cdrDesc?: string; error?: string; hash?: string; duplicado?: boolean; documentoConsolidadoId?: string }
}

const SUNAT_ESTADO: Record<string, { variant: 'success' | 'destructive' | 'warning' | 'secondary'; label: string }> = {
  aceptado: { variant: 'success', label: 'Enviado' },
  rechazado: { variant: 'destructive', label: 'Rechazado' },
  error: { variant: 'destructive', label: 'Error' },
  enviando: { variant: 'warning', label: 'Enviando…' },
  pendiente: { variant: 'secondary', label: 'Pendiente' },
}
const estadoSunat = (estado?: string) => SUNAT_ESTADO[(estado || 'pendiente').toLowerCase()] ?? SUNAT_ESTADO.pendiente

const badgeSunat = (d: Doc) => {
  const st = estadoSunat(d.sunat?.estado)
  const cdr = d.sunat?.cdrCode
  const label = cdr !== undefined && cdr !== null ? `${st.label} · CDR ${cdr}` : st.label
  const tooltip = d.sunat?.cdrDesc || d.sunat?.error || ''
  return { variant: st.variant, label, tooltip }
}

const nvBoleta = (d: Doc) => {
  const idc = d.sunat?.documentoConsolidadoId
  if (!idc) return null
  return String(idc).replace(/^BOLETA-/i, '')
}

function mesDeHoy() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function Reportes() {
  const { config: cfg } = useConfiguracion()
  const { tienePermiso, nombre: nombreUsuario } = usePermisos()
  const { user } = useAuth()
  const { toast, confirm } = useNotifications()
  // Scope por usuario: si no tiene 'verTodo', solo ve sus propios documentos.
  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? '' : (user?.uid || '')
  const [tab, setTab] = React.useState<'nv' | 'consolidado' | 'sunat'>('nv')
  const [filtroTipo, setFiltroTipo] = React.useState<'BOLETA' | 'FACTURA' | 'NC' | 'ND'>('BOLETA')
  const [mes, setMes] = React.useState(mesDeHoy())
  const [notaDoc, setNotaDoc] = React.useState<Doc | null>(null)
  const [notaTipo, setNotaTipo] = React.useState<'NC' | 'ND'>('NC')
  const [notaMotivo, setNotaMotivo] = React.useState('01')
  const [notaAfectaStock, setNotaAfectaStock] = React.useState(true)
  const [creandoNota, setCreandoNota] = React.useState(false)
  const [enviandoId, setEnviandoId] = React.useState<string | null>(null)
  const [nvsDelDia, setNvsDelDia] = React.useState<Doc[]>([])
  const [anularDoc, setAnularDoc] = React.useState<Doc | null>(null)
  const [anularMotivo, setAnularMotivo] = React.useState('')
  const [corregirDoc, setCorregirDoc] = React.useState<Doc | null>(null)
  const [corregirTipo, setCorregirTipo] = React.useState<'efectivo' | 'transferencia'>('efectivo')
  const [corregirRef, setCorregirRef] = React.useState('')
  const [procesando, setProcesando] = React.useState(false)
  const [consolidando, setConsolidando] = React.useState(false)
  const [refreshConsol, setRefreshConsol] = React.useState(0)

  const [añoMesTarget] = React.useMemo(() => {
    const [y, m] = mes.split('-')
    return [`${y}-${Number(m)}`]
  }, [mes])

  // ── Notas de Venta del mes (paginación real) ──
  const baseQueryNV = React.useMemo(
    () => query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', 'NV'), where('anioMes', '==', añoMesTarget), ...(miUid ? [where('usuarioId', '==', miUid)] : []), orderBy('fecha', 'desc')),
    [añoMesTarget, miUid]
  )
  const nvPag = usePaginacionFirestore<Doc>({ baseQuery: baseQueryNV, enabled: tab === 'nv' })

  // ── Registro SUNAT (según tipo + mes) ──
  const baseQuerySunat = React.useMemo(
    () => query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', filtroTipo), where('anioMes', '==', añoMesTarget), ...(miUid ? [where('usuarioId', '==', miUid)] : []), orderBy('fecha', 'desc')),
    [filtroTipo, añoMesTarget, miUid]
  )
  const sunatPag = usePaginacionFirestore<Doc>({ baseQuery: baseQuerySunat, enabled: tab === 'sunat' })

  // ── Consolidado: NV de las últimas 24h (ventana rolling) ──
  React.useEffect(() => {
    if (tab !== 'consolidado') return
    let activo = true
    const ahora = new Date()
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000).toISOString()
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', 'NV'), where('fecha', '>=', hace24h), ...(miUid ? [where('usuarioId', '==', miUid)] : []), orderBy('fecha', 'desc')))
        if (!activo) return
        setNvsDelDia(snap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<Doc, 'id'>) })).filter((d) => !d.sunat?.consolidado && d.estado !== 'anulada'))
      } catch (e) {
        console.error('❌ Error cargando consolidado:', e)
      }
    })()
    return () => {
      activo = false
    }
  }, [tab, refreshConsol, miUid])

  const sumPaginaNv = nvPag.items.reduce((s, d) => s + (d.venta?.total ?? 0), 0)
  const sumPaginaSunat = sunatPag.items.reduce((s, d) => s + (d.tipoDoc === 'NC' ? -Math.abs(d.venta?.total ?? 0) : d.venta?.total ?? 0), 0)

  const totalConsolidado = nvsDelDia.reduce((s, d) => s + (d.venta?.total ?? 0), 0)
  const montoDe = (d: Doc, tipo: string) => {
    const ven = d.venta as any
    const pagos = ven?.pagos && ven.pagos.length ? ven.pagos : (ven?.tipoPago ? [{ tipo: ven.tipoPago, monto: ven.total }] : [])
    return pagos.filter((p: any) => p.tipo === tipo).reduce((s: number, p: any) => s + (p.monto || 0), 0)
  }
  const totalEfectivo = nvsDelDia.reduce((s, d) => s + montoDe(d, 'efectivo'), 0)
  const totalTransferencia = nvsDelDia.reduce((s, d) => s + montoDe(d, 'transferencia'), 0)

  const verPDF = (d: Doc) => abrirPDFComprobante(d, cfg)

  async function exportarExcelNv() {
    const items = nvPag.items
    if (items.length === 0) { toast('No hay NV para exportar', 'warning'); return }
    const headers = ['Fecha', 'Serie/Número', 'Cliente', 'DNI', 'Items', 'Total', 'Tipo Pago', 'Cajero', 'Estado']
    const rows = items.map((d) => {
      const fecha = d.fecha ? new Date(d.fecha).toLocaleString('es-PE') : ''
      const cliente = d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'
      const dni = d.venta?.cliente_dni && d.venta.cliente_dni !== '-' ? d.venta.cliente_dni : ''
      const itemCount = d.venta?.items?.length ?? 0
      const total = d.venta?.total ?? 0
      const tipoPago = d.venta?.tipoPago ?? ''
      const cajero = d.venta?.cajero ?? ''
      const estado = d.estado === 'anulada' ? 'Anulada' : 'Vigente'
      return [fecha, d.serieNumero ?? '', cliente, dni, itemCount, total, tipoPago, cajero, estado]
    })
    const [y, m] = mes.split('-')
    await exportarExcel([{ name: 'Notas de Venta', headers, rows }], `NV_${y}${m}.xlsx`, { empresa: cfg?.nombre || 'AppADM', titulo: `Notas de Venta — ${mes}` })
    toast('Excel exportado', 'success')
  }

  async function exportarExcelSunat() {
    const items = sunatPag.items
    if (items.length === 0) { toast('No hay documentos para exportar', 'warning'); return }
    const headers = ['Fecha', 'Tipo', 'Serie/Número', 'Cliente', 'DNI', 'Total', 'Estado SUNAT', 'CDR']
    const rows = items.map((d) => {
      const fecha = d.fecha ? new Date(d.fecha).toLocaleString('es-PE') : ''
      const tipo = SUNAT_TIPOS.find((t) => t.key === d.tipoDoc)?.label ?? d.tipoDoc ?? ''
      const cliente = d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'
      const dni = d.venta?.cliente_dni && d.venta.cliente_dni !== '-' ? d.venta.cliente_dni : ''
      const total = d.tipoDoc === 'NC' ? -Math.abs(d.venta?.total ?? 0) : (d.venta?.total ?? 0)
      const estado = d.sunat?.estado ?? 'pendiente'
      const cdr = d.sunat?.cdrCode ?? ''
      return [fecha, tipo, d.serieNumero ?? '', cliente, dni, total, estado, cdr]
    })
    const [y, m] = mes.split('-')
    await exportarExcel([{ name: 'Registro SUNAT', headers, rows }], `SUNAT_${y}${m}.xlsx`, { empresa: cfg?.nombre || 'AppADM', titulo: `Registro SUNAT — ${mes}` })
    toast('Excel exportado', 'success')
  }

  const esDeHoy = (iso?: string) => {
    if (!iso) return false
    const f = new Date(iso)
    const hoy = new Date()
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth() && f.getDate() === hoy.getDate()
  }

  const puedeAnular = (d: Doc) => {
    if (!tienePermiso('anularVenta') || d.estado === 'anulada' || d.sunat?.consolidado || !esDeHoy(d.fecha || d.createdAt)) return false
    if (d.tipoDoc === 'NV') return true
    // Boletas/Facturas: solo si NO fueron aceptadas por SUNAT
    if (d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA') return d.sunat?.estado !== 'aceptado'
    return false
  }
  const puedeCorregir = (d: Doc) =>
    tienePermiso('corregirPago') &&
    (d.tipoDoc === 'NV' ? !d.sunat?.consolidado : d.sunat?.estado == null || d.sunat.estado === 'pendiente')

  function abrirAnular(d: Doc) {
    setAnularDoc(d)
    setAnularMotivo('')
  }
  function abrirCorregir(d: Doc) {
    setCorregirDoc(d)
    setCorregirTipo((d.venta?.tipoPago as any) === 'efectivo' ? 'efectivo' : 'transferencia')
    setCorregirRef(d.venta?.referencia || '')
  }

  async function handleAnular() {
    if (!anularDoc) return
    const ok = await confirm({ title: 'Anular Nota de Venta', message: `¿Anular la Nota de Venta ${anularDoc.serieNumero ?? ''}?`, okText: 'Anular', destructive: true })
    if (!ok) return
    setProcesando(true)
    const r = await anularNotaVenta({ documentoId: anularDoc.id, motivo: anularMotivo || 'sin motivo' })
    setProcesando(false)
    if (r.success) {
      toast(`NV ${anularDoc.serieNumero ?? ''} anulada (stock revertido).`, 'success')
      setAnularDoc(null)
      nvPag.recargar()
    } else {
      toast(r.error || 'Error', 'error')
    }
  }

  async function handleCorregir() {
    if (!corregirDoc) return
    if (corregirTipo === 'transferencia' && !corregirRef.trim()) {
      toast('Ingresá la referencia de la transferencia', 'warning'); return
    }
    setProcesando(true)
    const r = await corregirTipoPago(corregirDoc.id, corregirTipo, corregirRef.trim())
    setProcesando(false)
    if (r.success) {
      toast(`Tipo de pago corregido a ${corregirTipo === 'efectivo' ? 'Efectivo' : 'Transferencia'}.`, 'success')
      setCorregirDoc(null)
      nvPag.recargar()
      sunatPag.recargar()
    } else {
      toast(r.error || 'Error', 'error')
    }
  }

  async function handleConsolidar() {
    if (nvsDelDia.length === 0) return
    const ok = await confirm({ title: 'Consolidar en BOLETA', message: `¿Consolidar ${nvsDelDia.length} Nota(s) de Venta en una BOLETA?`, okText: 'Consolidar' })
    if (!ok) return
    setConsolidando(true)
    try {
      const r = await generarConsolidado(nvsDelDia, cfg, nombreUsuario || user?.email || 'sistema', user?.uid || '')
      if (r.success) {
        toast(`Consolidado en BOLETA ${r.correlativo} (${r.nvsProcesadas} NV · ${fmt(r.total ?? 0)}).`, 'success')
        setRefreshConsol((v) => v + 1)
      } else {
        toast(r.error || 'Error', 'error')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setConsolidando(false)
    }
  }

  async function enviarDoc(d: Doc) {
    if (!cfg?.sunatApiUrlProd) {
      toast('Configurá la URL de la API SUNAT en Configuración → API SUNAT (Producción).', 'warning'); return
    }
    const ok = await confirm({
      title: 'Enviar a SUNAT',
      message: `¿Enviar el comprobante ${d.serieNumero ?? `${d.serie}-${String(d.numero ?? '').padStart(6, '0')}`} a SUNAT?\n\nTipo: ${SUNAT_TIPOS.find((t) => t.key === d.tipoDoc)?.label ?? d.tipoDoc} · Cliente: ${d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'}\nTotal: ${fmt(d.venta?.total ?? 0)}\n\nEsta acción envía un comprobante real a SUNAT.`,
      okText: 'Enviar',
    })
    if (!ok) return
    setEnviandoId(d.id)
    try {
      const r = await enviarDocumentoASunat(d, cfg)
      if (r.yaAceptado) toast(`${d.serieNumero ?? ''} ya está aceptado en SUNAT.`, 'info')
      else if (r.success) toast(`Enviado a SUNAT: ${r.message ?? 'aceptado'} — ${d.serieNumero ?? ''}`, 'success')
      else toast(r.error || 'No se pudo enviar', 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setEnviandoId(null)
      if (tab === 'nv') nvPag.recargar()
      if (tab === 'sunat') sunatPag.recargar()
    }
  }

  async function enviarNota(d: Doc) {
    if (!cfg?.sunatApiUrlProd) {
      toast('Configurá la URL de la API SUNAT en Configuración → API SUNAT (Producción).', 'warning'); return
    }
    const ok = await confirm({
      title: 'Enviar nota a SUNAT',
      message: `¿Enviar la nota ${d.serieNumero ?? `${d.serie}-${String(d.numero ?? '').padStart(6, '0')}`} a SUNAT?\n\nTipo: ${d.tipoDoc === 'NC' ? 'Nota de Crédito' : 'Nota de Débito'} · Cliente: ${d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'}\nTotal: ${fmt(d.venta?.total ?? 0)}\n\nEsta acción envía la nota real a SUNAT.`,
      okText: 'Enviar',
    })
    if (!ok) return
    setEnviandoId(d.id)
    try {
      const r = await enviarNotaASunat(d, cfg)
      if (r.yaAceptado) toast(`${d.serieNumero ?? ''} ya está aceptado en SUNAT.`, 'info')
      else if (r.success) toast(`Nota enviada a SUNAT: ${r.message ?? 'aceptado'} — ${d.serieNumero ?? ''}`, 'success')
      else toast(r.error || 'No se pudo enviar', 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setEnviandoId(null)
      if (tab === 'nv') nvPag.recargar()
      if (tab === 'sunat') sunatPag.recargar()
    }
  }

  function abrirNota(d: Doc, tipo: 'NC' | 'ND') {
    setNotaDoc(d)
    setNotaTipo(tipo)
    setNotaMotivo(tipo === 'NC' ? '01' : '02')
    setNotaAfectaStock(tipo === 'NC')
  }

  async function crearNota() {
    if (!notaDoc) return
    // Una NC/ND también afecta caja/stock → exige turno abierto (igual que los comprobantes).
    const turno = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
    if (!turno) { toast('🚫 No hay un turno abierto. Abrí un turno antes de emitir la nota.', 'error'); return }
    setCreandoNota(true)
    const motivo = TIPOS_NOTA_SUNAT.find((t) => t.codigo === notaMotivo && t.tipo === (notaTipo === 'NC' ? 'credito' : 'debito'))?.label || ''
    const r = await crearNotaCreditoDebito({
      documentoOriginal: notaDoc,
      tipoNota: notaTipo,
      motivo,
      codigoMotivo: notaMotivo,
      config: cfg,
      afectaStock: notaAfectaStock,
      turnoId: turno.id,
      cajero: nombreUsuario || user?.email || 'sistema',
    })
    setCreandoNota(false)
    if (r.success) {
      toast(`${notaTipo} ${r.correlativo} creada. No se envía a SUNAT.`, 'success')
      setNotaDoc(null)
      sunatPag.recargar()
    } else {
      toast(r.error || 'Error', 'error')
    }
  }

  const Row = ({ d, sunat, mostrarAcciones = false }: { d: Doc; sunat?: boolean; mostrarAcciones?: boolean }) => (
    <div className={cn("flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40", d.estado === 'anulada' && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{d.serieNumero ?? `${d.serie}-${String(d.numero ?? '').padStart(6, '0')}`}</div>
        <div className="truncate text-xs text-muted-foreground">
          {d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'} · {d.fecha ? new Date(d.fecha).toLocaleString('es-PE') : ''}
          {d.venta?.cajero ? ` · 👤 ${d.venta.cajero}` : ''}
        </div>
      </div>
      <span className={cn('num font-bold', d.tipoDoc === 'NC' && 'text-destructive')}>
        {d.tipoDoc === 'NC' ? '-' : ''}{fmt(d.venta?.total ?? 0)}
      </span>
      {sunat ? (
        <>
          <Badge variant={badgeSunat(d).variant} title={badgeSunat(d).tooltip || undefined}>{badgeSunat(d).label}</Badge>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => verPDF(d)}><Printer className="h-3.5 w-3.5" /> PDF</Button>
            {(d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA') && d.sunat?.estado === 'aceptado' && (
              <>
                <Button variant="outline" size="sm" className="text-amber-600" onClick={() => abrirNota(d, 'NC')}>NC</Button>
                <Button variant="outline" size="sm" className="text-pink-600" onClick={() => abrirNota(d, 'ND')}>ND</Button>
              </>
            )}
            {(d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA') && (
              <Button variant="outline" size="sm" onClick={() => enviarDoc(d)} disabled={enviandoId === d.id || d.sunat?.estado === 'aceptado'}>
                {enviandoId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {enviandoId === d.id ? 'Enviando…' : d.sunat?.estado === 'aceptado' ? 'Enviado' : 'Enviar'}
              </Button>
            )}
            {(d.tipoDoc === 'NC' || d.tipoDoc === 'ND') && (
              <Button variant="outline" size="sm" onClick={() => enviarNota(d)} disabled={enviandoId === d.id || d.sunat?.estado === 'aceptado'}>
                {enviandoId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {enviandoId === d.id ? 'Enviando…' : d.sunat?.estado === 'aceptado' ? 'Enviado' : 'Enviar'}
              </Button>
            )}
            {puedeCorregir(d) && (
              <Button variant="outline" size="sm" onClick={() => abrirCorregir(d)}><Wallet className="h-3.5 w-3.5" /> Pago</Button>
            )}
          </div>
        </>
      ) : (
        <span className="flex items-center gap-1.5">
          {d.estado === 'anulada' && (
            <span className="rounded-md bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">
              ANULADA
            </span>
          )}
          {d.estado !== 'anulada' && nvBoleta(d) && (
            <span className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Incluida en un consolidado de boleta">
              Boleta {nvBoleta(d)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => verPDF(d)}><Printer className="h-3.5 w-3.5" /> PDF</Button>
          {d.estado !== 'anulada' && mostrarAcciones && puedeCorregir(d) && (
            <Button variant="outline" size="sm" onClick={() => abrirCorregir(d)}><Wallet className="h-3.5 w-3.5" /> Pago</Button>
          )}
          {d.estado !== 'anulada' && mostrarAcciones && puedeAnular(d) && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => abrirAnular(d)}><Trash2 className="h-3.5 w-3.5" /> Anular</Button>
          )}
        </span>
      )}
    </div>
  )

  // Helper para una lista paginada (hook) con controles arriba y abajo.
  type Pag = { items: Doc[]; total: number; pagina: number; totalPaginas: number; loading: boolean; error: string | null; setPagina: (p: number) => void; recargar: () => void }
  const ListaHooked = ({ pag, renderItem, empty }: { pag: Pag; renderItem: (d: Doc) => React.ReactNode; empty: React.ReactNode }) => (
    <>
      <PaginadorControles total={pag.total} pagina={pag.pagina} totalPaginas={pag.totalPaginas} pageSize={PAGE} onPagina={pag.setPagina} sum={pag === nvPag ? sumPaginaNv : sumPaginaSunat} className="border-b bg-muted/30" />
      {pag.loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span></div>
      ) : pag.error ? (
        <div className="p-5 text-sm text-destructive">{pag.error}</div>
      ) : (
        <div className="divide-y">{pag.items.length === 0 ? empty : pag.items.map((d) => renderItem(d))}</div>
      )}
      {pag.totalPaginas > 1 && <PaginadorControles total={pag.total} pagina={pag.pagina} totalPaginas={pag.totalPaginas} pageSize={PAGE} onPagina={pag.setPagina} sum={pag === nvPag ? sumPaginaNv : sumPaginaSunat} className="border-t" />}
    </>
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {([
          { id: 'nv', label: 'Notas de Venta', icon: FileText },
          { id: 'consolidado', label: 'Consolidado de Boletas', icon: Receipt },
          { id: 'sunat', label: 'Registro SUNAT', icon: CloudUpload },
        ] as const).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer', tab === t.id ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'nv' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Notas de Venta del mes</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportarExcelNv} disabled={nvPag.items.length === 0}>
                <Download className="mr-1 h-3.5 w-3.5" /> Excel
              </Button>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 rounded-lg border px-3 text-sm" />
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card shadow-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold">Notas de Venta</span>
              <span className="num text-sm text-muted-foreground">{nvPag.total} doc · {fmt(sumPaginaNv)}</span>
            </div>
            <ListaHooked pag={nvPag} renderItem={(d) => <Row key={d.id} d={d} mostrarAcciones />} empty={<p className="py-16 text-center text-sm text-muted-foreground">Sin notas de venta en este mes</p>} />
          </div>
        </div>
      ) : tab === 'consolidado' ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="border-b px-4 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-bold">Consolidado de Boletas — Últimas 24h</span>
              <div className="flex items-center gap-2">
                <span className="num text-sm text-muted-foreground">{nvsDelDia.length} NV</span>
                {tienePermiso('consolidado') && nvsDelDia.length > 0 && (
                  <Button size="sm" onClick={handleConsolidar} disabled={consolidando}>
                    {consolidando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                    {consolidando ? 'Consolidando…' : 'Consolidar a Boleta'}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-muted/60 p-2"><div className="text-xs text-muted-foreground">Total</div><div className="num font-bold">{fmt(totalConsolidado)}</div></div>
              <div className="rounded-lg bg-muted/60 p-2"><div className="text-xs text-muted-foreground">Efectivo</div><div className="num font-bold">{fmt(totalEfectivo)}</div></div>
              <div className="rounded-lg bg-muted/60 p-2"><div className="text-xs text-muted-foreground">Transferencia</div><div className="num font-bold">{fmt(totalTransferencia)}</div></div>
            </div>
          </div>
          <ListaPaginada
            items={nvsDelDia}
            renderItem={(d) => <Row key={d.id} d={d} />}
            empty={<p className="py-16 text-center text-sm text-muted-foreground">No hay notas de venta del día pendientes</p>}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5 rounded-xl bg-muted p-1">
              {SUNAT_TIPOS.map((t) => (
                <button key={t.key} onClick={() => setFiltroTipo(t.key)} className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', filtroTipo === t.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportarExcelSunat} disabled={sunatPag.items.length === 0}>
                <Download className="mr-1 h-3.5 w-3.5" /> Excel
              </Button>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 rounded-lg border px-3 text-sm" />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold">{SUNAT_TIPOS.find((t) => t.key === filtroTipo)?.label}</span>
              <span className="num text-sm text-muted-foreground">{sunatPag.total} doc · {fmt(sumPaginaSunat)}</span>
            </div>
            <ListaHooked pag={sunatPag} renderItem={(d) => <Row key={d.id} d={d} sunat />} empty={<p className="py-16 text-center text-sm text-muted-foreground">Sin {SUNAT_TIPOS.find((t) => t.key === filtroTipo)?.label.toLowerCase()} en este mes</p>} />
          </div>
        </div>
      )}

      {/* Modal nota de crédito / débito (solo crea el doc, sin enviar) */}
      {notaDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Emitir {notaTipo}</h2>
              <button onClick={() => setNotaDoc(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Sobre {notaDoc.serieNumero} · {fmt(notaDoc.venta?.total ?? 0)} · {notaDoc.venta?.cliente_nombre !== '-' ? notaDoc.venta?.cliente_nombre : 'Consumidor'}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Tipo</label>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {(['NC', 'ND'] as const).map((t) => (
                    <button key={t} onClick={() => { setNotaTipo(t); setNotaMotivo(t === 'NC' ? '01' : '02') }} className={cn('h-10 rounded-lg text-sm font-bold border cursor-pointer', notaTipo === t ? (t === 'NC' ? 'bg-amber-500 text-white border-amber-500' : 'bg-pink-600 text-white border-pink-600') : 'bg-background hover:bg-accent')}>
                      {t === 'NC' ? 'Crédito' : 'Débito'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Motivo</label>
                <select value={notaMotivo} onChange={(e) => setNotaMotivo(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {TIPOS_NOTA_SUNAT.filter((t) => t.tipo === (notaTipo === 'NC' ? 'credito' : 'debito')).map((t) => (
                    <option key={t.codigo + t.tipo} value={t.codigo}>{t.codigo} · {t.label}</option>
                  ))}
                </select>
              </div>
              {notaTipo === 'NC' && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={notaAfectaStock} onChange={(e) => setNotaAfectaStock(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                  Reincorporar stock al inventario
                </label>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setNotaDoc(null)}>Cancelar</Button>
              <Button className="flex-1" onClick={crearNota} disabled={creandoNota}>
                {creandoNota ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {creandoNota ? 'Emitiendo…' : `Emitir ${notaTipo}`}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Solo se crea el documento (correlativo + {notaTipo === 'NC' ? 'stock si aplica' : 'doc'}). No se envía a SUNAT.</p>
          </div>
        </div>
      )}

      {/* Modal Anular NV */}
      {anularDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Anular Nota de Venta</h2>
              <button onClick={() => setAnularDoc(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {anularDoc.serieNumero} · {fmt(anularDoc.venta?.total ?? 0)} · {anularDoc.venta?.cliente_nombre !== '-' ? anularDoc.venta?.cliente_nombre : 'Consumidor'}
            </p>
            <p className="mb-2 text-xs text-amber-700">Se revertirá el stock y se ajustará la caja del turno.</p>
            <textarea value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} placeholder="Motivo de la anulación (opcional)" rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAnularDoc(null)}>Cancelar</Button>
              <Button className="flex-1 bg-destructive text-white hover:bg-destructive/90" onClick={handleAnular} disabled={procesando}>
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {procesando ? 'Anulando…' : 'Anular'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Corregir pago */}
      {corregirDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Corregir tipo de pago</h2>
              <button onClick={() => setCorregirDoc(null)} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{corregirDoc.serieNumero} · {fmt(corregirDoc.venta?.total ?? 0)}</p>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Tipo de pago</label>
                <div className="mt-1 flex gap-1.5 rounded-xl bg-muted p-1">
                  {(['efectivo', 'transferencia'] as const).map((k) => (
                    <button key={k} onClick={() => setCorregirTipo(k)} className={cn('flex-1 rounded-lg py-2 text-sm font-bold cursor-pointer', corregirTipo === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
                      {k === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}
                    </button>
                  ))}
                </div>
              </div>
              {corregirTipo === 'transferencia' && (
                <div>
                  <label className="text-sm font-medium">Referencia</label>
                  <input value={corregirRef} onChange={(e) => setCorregirRef(e.target.value)} placeholder="N° de operación" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCorregirDoc(null)}>Cancelar</Button>
              <Button className="flex-1" onClick={handleCorregir} disabled={procesando}>
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {procesando ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
