import { Download, Loader2, RefreshCw, Plus, Search, UserRound, X } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, query, where, limit, startAfter, type QueryDocumentSnapshot, type DocumentData, type QueryConstraint } from 'firebase/firestore'
import { usePermisos } from '@/context/permisos'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { buscarClientes, type Cliente } from '@/services/clientes'
import { ClienteDetalle } from './ClienteDetalle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InfiniteScroll } from '@/components/ui/infinite-scroll'
import { exportarExcel } from '@/lib/excel'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { actualizarClasificacionesRFM, obtenerColorClasificacion, obtenerIconoClasificacion } from '@/services/rfm'

const AVATAR_COLORS = ['#0891B2', '#059669', '#7C3AED', '#D97706', '#DC2626', '#4F46E5', '#0D9488', '#DB2777']
const getInitials = (name?: string) => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}
const getAvatarColor = (name?: string) => {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const formatFecha = (iso?: string | null) => {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

type Vista = { tipo: 'lista' } | { tipo: 'detalle'; id?: string; nuevo?: boolean }

export function Clientes() {
  const { tienePermiso } = usePermisos()
  const [vista, setVista] = React.useState<Vista>({ tipo: 'lista' })

  if (!tienePermiso('clientes')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <UserRound className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Clientes</p>
        <p className="text-xs">Pedí el permiso «clientes» al administrador.</p>
      </div>
    )
  }

  if (vista.tipo === 'detalle') {
    return <ClienteDetalle clave={vista.id} nuevo={vista.nuevo} onBack={() => setVista({ tipo: 'lista' })} />
  }

  return <Lista onAbrir={(id) => setVista({ tipo: 'detalle', id })} onNuevo={() => setVista({ tipo: 'detalle', nuevo: true })} />
}

function Lista({ onAbrir, onNuevo }: { onAbrir: (id: string) => void; onNuevo: () => void }) {
  const { config: cfg } = useConfiguracion()
  const [busqueda, setBusqueda] = React.useState('')
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [cargando, setCargando] = React.useState(false)
  const [soloDeuda, setSoloDeuda] = React.useState(false)
  const [actualizandoRFM, setActualizandoRFM] = React.useState(false)

  // Infinite scroll para deudas
  const [cargandoMas, setCargandoMas] = React.useState(false)
  const [hayMas, setHayMas] = React.useState(true)
  const ultimoDocRef = React.useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const PAGE_SIZE = 25

  const cargarDeudasPagina = React.useCallback(async (afterDoc?: QueryDocumentSnapshot<DocumentData>, append = false) => {
    try {
      const constraints: QueryConstraint[] = [where('saldoPendiente', '>', 0), limit(PAGE_SIZE)]
      if (afterDoc) constraints.push(startAfter(afterDoc))
      const snap = await getDocs(query(collection(db, COL.CLIENTES), ...constraints))
      const nuevos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente))
      ultimoDocRef.current = snap.docs[snap.docs.length - 1] ?? null
      setHayMas(snap.docs.length === PAGE_SIZE)
      if (append) {
        setClientes((prev) => [...prev, ...nuevos])
      } else {
        setClientes(nuevos)
      }
    } catch {
      // Fallback: query sin where si falta índice
      try {
        const snap = await getDocs(collection(db, COL.CLIENTES))
        const todos: Cliente[] = []
        snap.forEach((d) => {
          const c = { id: d.id, ...d.data() } as Cliente
          if ((c.saldoPendiente ?? 0) > 0) todos.push(c)
        })
        setClientes(todos.sort((a, b) => (b.saldoPendiente ?? 0) - (a.saldoPendiente ?? 0)))
        setHayMas(false)
      } catch {
        setClientes([])
      }
    }
  }, [])

  async function cargarMasDeudas() {
    if (cargandoMas || !hayMas || !ultimoDocRef.current) return
    setCargandoMas(true)
    await cargarDeudasPagina(ultimoDocRef.current, true)
    setCargandoMas(false)
  }

  async function handleActualizarRFM() {
    setActualizandoRFM(true)
    try {
      await actualizarClasificacionesRFM()
      if (busqueda.trim().length >= 2) {
        const results = await buscarClientes(busqueda)
        setClientes(soloDeuda ? results.filter((c) => (c.saldoPendiente ?? 0) > 0) : results)
      }
    } catch (e) {
      console.error('Error actualizando RFM:', e)
    } finally {
      setActualizandoRFM(false)
    }
  }

  React.useEffect(() => {
    if (soloDeuda && busqueda.trim().length < 2) {
      setCargando(true)
      ultimoDocRef.current = null
      setHayMas(true)
      cargarDeudasPagina().finally(() => setCargando(false))
      return
    }
    if (busqueda.trim().length < 2) {
      setClientes([])
      return
    }
    setCargando(true)
    const t = setTimeout(async () => {
      let results = await buscarClientes(busqueda)
      if (soloDeuda) results = results.filter((c) => (c.saldoPendiente ?? 0) > 0)
      setClientes(results)
      setCargando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda, soloDeuda, cargarDeudasPagina])

  async function exportarExcelClientes() {
    if (clientes.length === 0) return
    const headers = ['Tipo Doc', 'N° Documento', 'Nombre / Razón Social', 'Dirección', 'Teléfono', 'Email', 'Frecuencia', 'Total Compras', 'Última Compra', 'Estado']
    const rows = clientes.map((c) => [
      c.tipoDoc ?? '',
      c.numeroDoc ?? '',
      c.razonSocial ?? c.nombre ?? '',
      c.direccion ?? '',
      c.telefono ?? '',
      c.email ?? '',
      c.frecuencia ?? '',
      c.totalCompras ?? 0,
      c.ultimaCompra ? new Date(c.ultimaCompra).toLocaleDateString('es-PE') : 'Nunca',
      c.bloqueado ? 'Bloqueado' : 'Activo',
    ])
    await exportarExcel([{ name: 'Clientes', headers, rows }], `Clientes_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { empresa: cfg?.nombre || 'AppADM', titulo: 'Registro de Clientes' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-extrabold">Clientes</h1>
        <div className="ml-auto flex gap-2">
          {clientes.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportarExcelClientes}><Download className="h-4 w-4" /> Excel</Button>
          )}
          <Button variant="outline" size="sm" onClick={handleActualizarRFM} disabled={actualizandoRFM}>
            {actualizandoRFM ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {actualizandoRFM ? 'Actualizando…' : 'RFM'}
          </Button>
          <Button onClick={onNuevo}><Plus className="h-4 w-4" /> Nuevo</Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por DNI, RUC o nombre…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-10" />
          {busqueda && (
            <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Limpiar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={soloDeuda}
            onChange={(e) => setSoloDeuda(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-orange-500"
          />
          <span className="whitespace-nowrap text-muted-foreground">Con deuda</span>
        </label>
      </div>

      {cargando && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
        </div>
      )}

      {!cargando && busqueda.trim().length < 2 && !soloDeuda && (
        <div className="py-16 text-center text-muted-foreground">
          <UserRound className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Buscar clientes</p>
          <p className="text-xs text-muted-foreground/70">Ingresa al menos 2 caracteres para buscar</p>
        </div>
      )}

      {!cargando && soloDeuda && clientes.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <UserRound className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Sin deudas pendientes</p>
          <p className="text-xs text-muted-foreground/70">No hay clientes con saldo a favor</p>
        </div>
      )}

      {!cargando && busqueda.trim().length >= 2 && clientes.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <Search className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground/70">No encontramos clientes con ese criterio</p>
        </div>
      )}

      {soloDeuda && busqueda.trim().length < 2 ? (
        <InfiniteScroll hayMas={hayMas} cargandoMas={cargandoMas} onCargarMas={cargarMasDeudas}>
          <div className="space-y-2.5">
            {clientes.map((item) => (
              <ClienteRow key={item.id} item={item} onAbrir={onAbrir} />
            ))}
          </div>
        </InfiniteScroll>
      ) : (
        <div className="space-y-2.5">
          {clientes.map((item) => (
            <ClienteRow key={item.id} item={item} onAbrir={onAbrir} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClienteRow({ item, onAbrir }: { item: Cliente; onAbrir: (id: string) => void }) {
  const avatarColor = getAvatarColor(item.razonSocial)
  const saldo = item.saldoPendiente || 0
  const clasificacion = item.frecuencia || 'Ocasional'
  const colorClasificacion = obtenerColorClasificacion(clasificacion)
  const iconoClasificacion = obtenerIconoClasificacion(clasificacion)

  return (
    <button onClick={() => onAbrir(item.id as string)} className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: avatarColor + '18' }}>
        <span className="text-sm font-bold" style={{ color: avatarColor }}>{getInitials(item.razonSocial)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold">{item.razonSocial || 'Sin nombre'}</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${colorClasificacion}`}>
            {iconoClasificacion} {clasificacion}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{String(item.tipoDoc || '').toUpperCase()}: {item.numeroDoc}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Última compra: {formatFecha(item.ultimaCompra)}</span>
          {item.creditoActivo && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold" style={{ color: saldo > 0 ? '#DC2626' : '#059669' }}>
              S/ {saldo.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
