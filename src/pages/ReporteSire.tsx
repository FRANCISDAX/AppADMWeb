import { Download, Loader2, Search } from 'lucide-react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { Button } from '@/components/ui/button'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

function mesDeHoy() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

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
  venta?: {
    total?: number
    cliente_nombre?: string
    cliente_dni?: string
    cliente_direccion?: string
    tipoPago?: string
    items?: {
      id: string
      nombre: string
      subtotal?: number
      precioVenta?: number
      cantidad?: number
      tipoAfectacion?: string
    }[]
    fecha?: string
    cajero?: string
    sucursal?: string
  }
  sunat?: { estado?: string }
}

type DocCalculado = Doc & {
  baseGravada: number
  baseExonerada: number
  baseInafecta: number
  igv: number
  totalCalc: number
  tipoDocSunat: string
  signo: number
}

function calcularDoc(d: Doc): DocCalculado {
  const signo = d.tipoDoc === 'NC' ? -1 : 1
  const items = d.venta?.items || []
  let baseGravada = 0
  let baseExonerada = 0
  let baseInafecta = 0

  for (const it of items) {
    const importe = Math.abs(Number(it.subtotal ?? ((it.precioVenta ?? 0) * (it.cantidad ?? 1))))
    const af = it.tipoAfectacion || '10'
    if (af.startsWith('10') || af.startsWith('11') || af.startsWith('12') || af.startsWith('13') || af.startsWith('14') || af.startsWith('15') || af.startsWith('16') || af.startsWith('17') || af.startsWith('18') || af.startsWith('19')) {
      baseGravada += importe
    } else if (af.startsWith('2')) {
      baseExonerada += importe
    } else if (af.startsWith('3') || af.startsWith('4')) {
      baseInafecta += importe
    }
  }

  // Si no hay items con tipoAfectacion, usar total directo como gravado
  if (items.length === 0) {
    baseGravada = Math.abs(d.venta?.total ?? 0)
  }

  const igv = Math.round(baseGravada * 0.18 * 100) / 100
  const totalCalc = baseGravada + igv + baseExonerada + baseInafecta

  // Mapear tipoDoc a código SUNAT
  let tipoDocSunat = '03' // Boleta por defecto
  if (d.tipoDoc === 'FACTURA') tipoDocSunat = '01'
  else if (d.tipoDoc === 'BOLETA') tipoDocSunat = '03'
  else if (d.tipoDoc === 'NC') tipoDocSunat = '07'
  else if (d.tipoDoc === 'ND') tipoDocSunat = '08'

  return {
    ...d,
    baseGravada: baseGravada * signo,
    baseExonerada: baseExonerada * signo,
    baseInafecta: baseInafecta * signo,
    igv: igv * signo,
    totalCalc: totalCalc * signo,
    tipoDocSunat,
    signo,
  }
}

function toCsvRows(docs: DocCalculado[]) {
  const periodo = docs[0]?.anioMes?.replace('-', '') || ''
  return docs.map((d) => {
    const fecha = d.fecha ? new Date(d.fecha) : new Date()
    const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`
    const cliDni = (d.venta?.cliente_dni || '') === '-' ? '' : d.venta?.cliente_dni || ''
    const cliNombre = (d.venta?.cliente_nombre || '') === '-' ? '' : d.venta?.cliente_nombre || ''
    const tipoDocCliente = cliDni.length === 11 ? '6' : '1'
    const estado = d.estado === 'anulada' ? '2' : '1'

    return [
      periodo,
      d.tipoDocSunat,
      d.serie || '',
      String(d.numero ?? '').padStart(7, '0'),
      fechaStr,
      tipoDocCliente,
      cliDni || '00000000',
      cliNombre || 'VARIOS',
      'PEN',
      d.baseGravada.toFixed(2),
      '0.00',
      d.totalCalc.toFixed(2),
      d.igv.toFixed(2),
      estado,
    ].join('|')
  })
}

function descargarCsv(rows: string[], nombre: string) {
  const header = 'Periodo|TipoDocumento|SerieDocumento|NumeroDocumento|FechaEmision|TipoDocumentoIdentidad|NumeroDocumento|RazonSocialSocial|TipoMoneda|MontoTotalOperacionesGravadas|MontoTotalDescuentos|MontoTotalVentas|MontoTotalImpuestos|EstadoItem'
  const content = header + '\n' + rows.join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

const TIPO_DOC_LABELS: Record<string, { label: string; color: string }> = {
  BOLETA: { label: 'Boletas', color: '#FF9800' },
  FACTURA: { label: 'Facturas', color: '#4CAF50' },
  NC: { label: 'Notas Crédito', color: '#F59E0B' },
  ND: { label: 'Notas Débito', color: '#E91E63' },
}

export function ReporteSire() {
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const { toast } = useNotifications()

  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? '' : (user?.uid || '')

  const [mes, setMes] = React.useState(mesDeHoy)
  const [docs, setDocs] = React.useState<Doc[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState<'todos' | 'BOLETA' | 'FACTURA' | 'NC' | 'ND'>('todos')

  const [añoMesTarget] = React.useMemo(() => {
    const [y, m] = mes.split('-')
    return [`${y}-${Number(m)}`]
  }, [mes])

  React.useEffect(() => {
    let activo = true
    setLoading(true)
    setError(null)

    const tipos = ['BOLETA', 'FACTURA', 'NC', 'ND']
    const baseFilters = [where('anioMes', '==', añoMesTarget)]
    if (miUid) baseFilters.push(where('usuarioId', '==', miUid))

    const promises = tipos.map((tipo) =>
      getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', tipo), ...baseFilters, orderBy('fecha', 'asc')))
    )

    Promise.all(promises)
      .then((snaps) => {
        if (!activo) return
        const allDocs = snaps.flatMap((s) =>
          s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Doc, 'id'>) }))
        )
        setDocs(allDocs)
        setLoading(false)
      })
      .catch((e) => {
        if (!activo) return
        setError('Error cargando documentos: ' + (e as Error).message)
        setLoading(false)
      })

    return () => { activo = false }
  }, [añoMesTarget, miUid])

  const docsCalc = React.useMemo(() => docs.map(calcularDoc), [docs])

  const docsFiltrados = React.useMemo(() => {
    if (filtro === 'todos') return docsCalc.filter((d) => d.estado !== 'anulada')
    return docsCalc.filter((d) => d.tipoDoc === filtro && d.estado !== 'anulada')
  }, [docsCalc, filtro])

  const totales = React.useMemo(() => {
    let baseGravada = 0
    let baseExonerada = 0
    let baseInafecta = 0
    let igv = 0
    let total = 0
    let cantidad = 0

    for (const d of docsFiltrados) {
      baseGravada += d.baseGravada
      baseExonerada += d.baseExonerada
      baseInafecta += d.baseInafecta
      igv += d.igv
      total += d.totalCalc
      cantidad++
    }

    return { baseGravada, baseExonerada, baseInafecta, igv, total, cantidad }
  }, [docsFiltrados])

  const totalesPorTipo = React.useMemo(() => {
    const tipos = ['BOLETA', 'FACTURA', 'NC', 'ND']
    return tipos.map((tipo) => {
      const items = docsCalc.filter((d) => d.tipoDoc === tipo && d.estado !== 'anulada')
      const anulados = docsCalc.filter((d) => d.tipoDoc === tipo && d.estado === 'anulada')
      const total = items.reduce((s, d) => s + d.totalCalc, 0)
      const igv = items.reduce((s, d) => s + d.igv, 0)
      return { tipo, cantidad: items.length, anulados: anulados.length, total, igv }
    })
  }, [docsCalc])

  const handleExportar = () => {
    if (docsFiltrados.length === 0) {
      toast('No hay documentos para exportar', 'warning')
      return
    }
    const rows = toCsvRows(docsFiltrados)
    const [y, m] = mes.split('-')
    descargarCsv(rows, `SIRE_${y}${m}.txt`)
    toast(`Exportado ${rows.length} documentos`, 'success')
  }

  if (!tienePermiso('sire')) {
    return <div className="p-8 text-center text-muted-foreground">No tienes permiso para ver esta sección.</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Registro de Ventas — SIRE</h1>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 rounded-lg border px-3 text-sm" />
          <Button variant="outline" size="sm" onClick={handleExportar} disabled={loading || docsFiltrados.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Resumen general */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Documentos</div>
          <div className="mt-1 text-2xl font-bold num">{totales.cantidad}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Base Gravada</div>
          <div className="mt-1 text-2xl font-bold num">{fmt(totales.baseGravada)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">IGV (18%)</div>
          <div className="mt-1 text-2xl font-bold num">{fmt(totales.igv)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Base Exonerada</div>
          <div className="mt-1 text-2xl font-bold num">{fmt(totales.baseExonerada)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Total Ventas</div>
          <div className="mt-1 text-2xl font-bold num text-primary">{fmt(totales.total)}</div>
        </div>
      </div>

      {/* Totales por tipo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {totalesPorTipo.map((t) => (
          <div key={t.tipo} className="rounded-xl border bg-card p-3 shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: TIPO_DOC_LABELS[t.tipo]?.color }}>{TIPO_DOC_LABELS[t.tipo]?.label}</span>
              <span className="text-xs text-muted-foreground">{t.cantidad} docs</span>
            </div>
            <div className="mt-1 text-lg font-bold num">{fmt(t.total)}</div>
            {t.anulados > 0 && <div className="mt-0.5 text-xs text-destructive">{t.anulados} anulados</div>}
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {([
          { key: 'todos', label: 'Todos' },
          { key: 'BOLETA', label: 'Boletas' },
          { key: 'FACTURA', label: 'Facturas' },
          { key: 'NC', label: 'Notas Crédito' },
          { key: 'ND', label: 'Notas Débito' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setFiltro(t.key)} className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', filtro === t.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista de documentos */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-bold">Detalle de Documentos</span>
          <span className="num text-sm text-muted-foreground">{docsFiltrados.length} documentos · {fmt(totales.total)}</span>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando documentos…</span>
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-destructive">{error}</div>
        ) : docsFiltrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p>Sin documentos para este mes</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Serie/Número</th>
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2 text-right">Base Grav.</th>
                  <th className="px-4 py-2 text-right">IGV</th>
                  <th className="px-4 py-2 text-right">Exonerado</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {docsFiltrados.map((d) => {
                  const label = TIPO_DOC_LABELS[d.tipoDoc || '']
                  const esAnulado = d.estado === 'anulada'
                  return (
                    <tr key={d.id} className={cn('hover:bg-muted/30', esAnulado && 'opacity-50')}>
                      <td className="px-4 py-2 text-xs">
                        {d.fecha ? new Date(d.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: `${label?.color}15`, color: label?.color }}>
                          {label?.label || d.tipoDoc}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{d.serieNumero ?? `${d.serie}-${String(d.numero ?? '').padStart(6, '0')}`}</td>
                      <td className="px-4 py-2 text-xs">{d.venta?.cliente_nombre && d.venta.cliente_nombre !== '-' ? d.venta.cliente_nombre : 'Consumidor'}</td>
                      <td className="px-4 py-2 text-right num text-xs">{d.baseGravada !== 0 ? fmt(d.baseGravada) : '—'}</td>
                      <td className="px-4 py-2 text-right num text-xs">{d.igv !== 0 ? fmt(d.igv) : '—'}</td>
                      <td className="px-4 py-2 text-right num text-xs">{d.baseExonerada !== 0 ? fmt(d.baseExonerada) : '—'}</td>
                      <td className={cn('px-4 py-2 text-right num text-xs font-bold', d.tipoDoc === 'NC' && 'text-destructive')}>
                        {d.tipoDoc === 'NC' ? '-' : ''}{fmt(Math.abs(d.totalCalc))}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {esAnulado ? (
                          <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">Anulado</span>
                        ) : d.sunat?.estado === 'aceptado' ? (
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Enviado</span>
                        ) : (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-bold">
                  <td className="px-4 py-2 text-xs" colSpan={4}>TOTALES ({totales.cantidad} documentos)</td>
                  <td className="px-4 py-2 text-right num text-xs">{fmt(totales.baseGravada)}</td>
                  <td className="px-4 py-2 text-right num text-xs">{fmt(totales.igv)}</td>
                  <td className="px-4 py-2 text-right num text-xs">{fmt(totales.baseExonerada)}</td>
                  <td className="px-4 py-2 text-right num text-xs">{fmt(totales.total)}</td>
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground shadow-card">
        <p className="font-bold mb-1">Notas:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li><strong>Base Gravada</strong>: Operaciones con IGV (código afectación 10-19)</li>
          <li><strong>Base Exonerada</strong>: Operaciones exoneradas de IGV (código 20-22)</li>
          <li><strong>Base Inafecta</strong>: Operaciones inafectas (código 30-40)</li>
          <li><strong>IGV</strong>: 18% de la Base Gravada</li>
          <li>El archivo CSV se exporta en formato pipe-delimited para carga en SUNAT SIRE</li>
          <li>Las Notas de Crédito se restan de los totales (signo negativo)</li>
        </ul>
      </div>
    </div>
  )
}
