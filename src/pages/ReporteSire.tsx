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
import {
  CABECERA_EXPORT_COMPRAS,
  armarRegistroCompras,
  fechaRegistro,
  filasExportCompras,
  type CompraRegistro,
} from '@/lib/registro-compras'
import { obtenerComprasDelMes } from '@/services/compras'
import { useConfiguracion } from '@/hooks/use-configuracion'

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

const CABECERA_VENTAS = 'Periodo|TipoDocumento|SerieDocumento|NumeroDocumento|FechaEmision|TipoDocumentoIdentidad|NumeroDocumento|RazonSocialSocial|TipoMoneda|MontoTotalOperacionesGravadas|MontoTotalDescuentos|MontoTotalVentas|MontoTotalImpuestos|EstadoItem'

function descargarCsv(rows: string[], nombre: string, header: string = CABECERA_VENTAS) {
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
  const { config } = useConfiguracion()

  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? '' : (user?.uid || '')

  const [tab, setTab] = React.useState<'ventas' | 'compras'>('ventas')
  const [mes, setMes] = React.useState(mesDeHoy)
  const [docs, setDocs] = React.useState<Doc[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState<'todos' | 'BOLETA' | 'FACTURA' | 'NC' | 'ND'>('todos')

  /**
   * El **Registro de Compras**: las compras del mes agrupadas por comprobante del proveedor.
   * 🔑 **Se guarda con el mes al que pertenecen** y el «cargando» se **deriva** (`mes pedido ≠ mes cargado`):
   * así el efecto no llama a `setState` de forma síncrona (que encadena renders y sube el baseline de lint) y
   * nunca se muestran las compras de un mes mientras se pide otro.
   */
  const [comprasMes, setComprasMes] = React.useState<{ mes: string; datos: CompraRegistro[]; error: string | null }>({
    mes: '',
    datos: [],
    error: null,
  })

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

  /**
   * Las compras del mes elegido. ⚠️ **No se filtra por usuario**: un libro de compras es del negocio, no de
   * quien lo cargó (a diferencia del registro de ventas, donde el alcance por usuario es una decisión).
   */
  React.useEffect(() => {
    let activo = true
    const [y, m] = mes.split('-').map(Number)
    obtenerComprasDelMes(y, m)
      .then((c) => { if (activo) setComprasMes({ mes, datos: c, error: null }) })
      .catch((e) => { if (activo) setComprasMes({ mes, datos: [], error: 'Error cargando compras: ' + (e as Error).message }) })
    return () => { activo = false }
  }, [mes])

  const loadingCompras = comprasMes.mes !== mes
  const errorCompras = comprasMes.mes === mes ? comprasMes.error : null

  // ⚠️ Se depende de `comprasMes` (que cambia sólo cuando llegan las compras) y **no** de un array derivado:
  // un `compras` recalculado en cada render invalidaría el memo siempre (`exhaustive-deps`).
  const registroCompras = React.useMemo(
    () =>
      armarRegistroCompras(comprasMes.mes === mes ? comprasMes.datos : [], {
        igvRecuperable: Boolean(config.igvRecuperable),
      }),
    [comprasMes, mes, config.igvRecuperable],
  )

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

  /**
   * El export del registro de compras: **una fila por comprobante** con los campos del RCE (base e IGV
   * separados por con/sin derecho a crédito, el CAR, el proveedor y su RUC). Mismo formato pipe-delimited que
   * el de ventas, con la cabecera del registro de compras.
   */
  const handleExportarCompras = () => {
    if (registroCompras.filas.length === 0) {
      toast('No hay compras para exportar', 'warning')
      return
    }
    const rows = filasExportCompras(registroCompras, { ruc: config.ruc, nombre: config.nombre })
    const [y, m] = mes.split('-')
    descargarCsv(rows, `RCE_compras_${y}${m}.txt`, CABECERA_EXPORT_COMPRAS)
    toast(`Exportados ${rows.length} comprobantes de compra`, 'success')
  }

  if (!tienePermiso('sire')) {
    return <div className="p-8 text-center text-muted-foreground">No tienes permiso para ver esta sección.</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* 🔑 **Dos registros, una pantalla**: el de VENTAS (RVIE) y el de COMPRAS (RCE) son los dos libros que
          SUNAT pide en el SIRE. Cada uno tiene su propia tabla, sus totales y su export. */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {([
          { key: 'ventas', label: 'Ventas' },
          { key: 'compras', label: 'Compras' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-colors cursor-pointer',
              tab === t.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t.key === 'ventas' ? '📤 Ventas' : '📥 Compras'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{tab === 'ventas' ? 'Registro de Ventas — SIRE' : 'Registro de Compras — SIRE'}</h1>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 rounded-lg border px-3 text-sm" />
          <Button
            variant="outline"
            size="sm"
            onClick={tab === 'ventas' ? handleExportar : handleExportarCompras}
            disabled={tab === 'ventas' ? loading || docsFiltrados.length === 0 : loadingCompras || registroCompras.filas.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      {tab === 'ventas' ? (
      <>

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
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs font-semibold">{d.serieNumero ?? `${d.serie}-${String(d.numero ?? '').padStart(6, '0')}`}</td>
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
      </>
      ) : (
      <>
        {/* ─── REGISTRO DE COMPRAS (SUNAT · RCE) ───────────────────────────────────────────────────────
            La estructura y las reglas salen del Anexo 8.4 de la RS 040-2022/SUNAT (`lib/registro-compras.ts`):
            una fila por **comprobante del proveedor**, con el CAR de 27 dígitos, la base imponible y el IGV
            separados por **con o sin derecho a crédito fiscal**, y las adquisiciones no gravadas. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">Comprobantes</div>
            <div className="mt-1 text-2xl font-bold num">{registroCompras.totales.comprobantes}</div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">Base gravada (DG)</div>
            <div className="mt-1 text-2xl font-bold num">{fmt(registroCompras.totales.baseConCredito)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">con derecho a crédito</div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">IGV (DG)</div>
            <div className="mt-1 text-2xl font-bold num text-emerald-600">{fmt(registroCompras.totales.igvConCredito)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">crédito fiscal del mes</div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">No gravadas</div>
            <div className="mt-1 text-2xl font-bold num">{fmt(registroCompras.totales.noGravadas)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">sin IGV en la factura</div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">Total compras</div>
            <div className="mt-1 text-2xl font-bold num text-primary">{fmt(registroCompras.totales.total)}</div>
          </div>
        </div>

        {/* Lo que le falta a alguna compra para poder anotarla en el registro */}
        {registroCompras.avisos.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-500/10">
            <p className="font-bold text-amber-800 dark:text-amber-300">
              {registroCompras.avisos.length} comprobante(s) sin todos los datos del registro
            </p>
            <ul className="mt-1 space-y-0.5 text-amber-800/90 dark:text-amber-300/90">
              {registroCompras.avisos.slice(0, 5).map((a) => (
                <li key={a.compraId}>· {a.proveedor || a.compraId}: falta {a.falta.join(', ')}</li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/80">
              Se pueden completar cargando la próxima compra de ese proveedor con el tipo y el serie/número del
              comprobante (el dato viejo queda como está: no se inventa).
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-bold">Comprobantes de compra del mes</span>
            <span className="num text-sm text-muted-foreground">
              {registroCompras.filas.length} comprobantes · {fmt(registroCompras.totales.total)}
            </span>
          </div>

          {loadingCompras ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando compras…</span>
            </div>
          ) : errorCompras ? (
            <div className="p-5 text-sm text-destructive">{errorCompras}</div>
          ) : registroCompras.filas.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p>Sin compras registradas este mes</p>
              <p className="mt-1 text-xs">Se cargan en Inventario → «Ingreso / Compra».</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Comprobante</th>
                    <th className="px-4 py-2">Proveedor</th>
                    <th className="px-4 py-2 text-right">Base grav.</th>
                    <th className="px-4 py-2 text-right">IGV</th>
                    <th className="px-4 py-2 text-right">No gravado</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {registroCompras.filas.map((f) => (
                    <tr key={f.compraId} className="hover:bg-muted/30">
                      <td className="px-4 py-2 text-xs">{fechaRegistro(f.fecha)}</td>
                      <td className="px-4 py-2">
                        <div className="text-xs font-bold">{f.tipoComprobanteLabel}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {f.serie && f.numero ? `${f.serie}-${f.numero}` : 'sin serie/número'}
                          {f.leidoDeNota && (
                            <span
                              className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                              title={f.tipoPorSerie
                                ? 'Compra anterior a los campos de comprobante: la serie y el número se leyeron de la nota, y el tipo, de la letra de la serie. Conviene que el contador lo revise.'
                                : 'Compra anterior a los campos de comprobante: la serie y el número se leyeron de la nota.'}
                            >
                              de la nota
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground/70">CAR {f.car || '—'}</div>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div>{f.proveedor || '—'}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {f.proveedorDocumento ? `${f.tipoDocIdentidad === '6' ? 'RUC' : f.tipoDocIdentidad === '1' ? 'DNI' : 'Doc'} ${f.proveedorDocumento}` : 'sin documento'}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right num text-xs">
                        {fmt(f.baseConCredito)}
                        {f.baseSinCredito !== 0 && (
                          <div className="text-[10px] text-muted-foreground">+ {fmt(f.baseSinCredito)} sin crédito</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right num text-xs">
                        {fmt(f.igvConCredito)}
                        {f.igvSinCredito !== 0 && (
                          <div className="text-[10px] text-muted-foreground">+ {fmt(f.igvSinCredito)} sin crédito</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right num text-xs">{f.noGravadas !== 0 ? fmt(f.noGravadas) : '—'}</td>
                      <td className={cn('px-4 py-2 text-right num text-xs font-bold', f.signo < 0 && 'text-destructive')}>
                        {f.signo < 0 ? '-' : ''}{fmt(Math.abs(f.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50 font-bold">
                    <td className="px-4 py-2 text-xs" colSpan={3}>TOTALES ({registroCompras.totales.comprobantes} comprobantes)</td>
                    <td className="px-4 py-2 text-right num text-xs">
                      {fmt(registroCompras.totales.baseConCredito)}
                      {registroCompras.totales.baseSinCredito !== 0 && (
                        <div className="text-[10px] font-normal text-muted-foreground">+ {fmt(registroCompras.totales.baseSinCredito)} sin crédito</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right num text-xs">
                      {fmt(registroCompras.totales.igvConCredito)}
                      {registroCompras.totales.igvSinCredito !== 0 && (
                        <div className="text-[10px] font-normal text-muted-foreground">+ {fmt(registroCompras.totales.igvSinCredito)} sin crédito</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right num text-xs">{fmt(registroCompras.totales.noGravadas)}</td>
                    <td className="px-4 py-2 text-right num text-xs">{fmt(registroCompras.totales.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground shadow-card">
          <p className="font-bold mb-1">Cómo se arma este registro (SUNAT · RCE):</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><strong>Una fila por comprobante del proveedor</strong>: las líneas de una misma compra se suman en su comprobante.</li>
            <li><strong>Es el comprobante el que manda</strong>, no el catálogo: si la factura trae IGV, la base se despeja (÷ 1,18) y el resto es IGV; si no lo trae, todo va a <strong>no gravadas</strong> (una compra en Lima con IGV y un producto que acá se vende exonerado se declara con su IGV).</li>
            <li><strong>Con o sin derecho a crédito fiscal</strong> son columnas distintas (DG / DGNG) y lo decide <em>Configuración → Empresa → «Recupero el IGV de mis compras»</em> <b>al momento de cargar la compra</b> (queda guardado con ella).</li>
            <li><strong>El CAR</strong> son 27 caracteres: RUC del proveedor (11) + tipo (2) + serie (4) + número (10), con ceros a la izquierda (Tabla 7 del anexo).</li>
            <li>Las <strong>notas de crédito</strong> del proveedor van en negativo y restan del registro.</li>
            {registroCompras.totales.comprobantesDeNota > 0 && (
              <li>
                <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">de la nota</span>{' '}
                <strong>{registroCompras.totales.comprobantesDeNota} comprobante(s)</strong> son <strong>compras anteriores</strong> a los campos nuevos: la serie y el número se leyeron de la <em>nota</em> de la compra (donde se escribían a mano) y el tipo, de la <strong>letra de la serie</strong> (<em>F</em> = factura, <em>B</em> = boleta). Las compras cargadas desde ahora ya traen esos datos en sus propios campos y no dependen de la nota.
              </li>
            )}
            <li>⚠️ El export es para <b>revisar y cargar</b> en el SIRE (SUNAT asigna el CAR en su propuesta y valida el archivo); no reemplaza el envío en el portal.</li>
          </ul>
        </div>
      </>
      )}
    </div>
  )
}
