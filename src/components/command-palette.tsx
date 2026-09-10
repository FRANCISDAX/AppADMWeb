import { collection, getDocs, query, limit } from 'firebase/firestore'
import { Calculator, FileText, LayoutDashboard, Package, Search, Settings, Shield, ShoppingCart, UserRound, Users, X } from 'lucide-react'
import * as React from 'react'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'

type SearchResult = {
  id: string
  title: string
  subtitle: string
  type: 'page' | 'product' | 'client'
  icon: React.ReactNode
  action: () => void
}

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, perm: 'dashboard' },
  { id: 'pdv', label: 'Punto de Venta', icon: <ShoppingCart className="h-4 w-4" />, perm: 'ventas' },
  { id: 'turnos', label: 'Turnos', icon: <Calculator className="h-4 w-4" />, perm: 'turnos' },
  { id: 'inventario', label: 'Inventario', icon: <Package className="h-4 w-4" />, perm: 'inventario' },
  { id: 'reportes', label: 'Facturación', icon: <FileText className="h-4 w-4" />, perm: 'reportes' },
  { id: 'arqueoCaja', label: 'Arqueo de Caja', icon: <Calculator className="h-4 w-4" />, perm: 'arqueoCaja' },
  { id: 'analisis', label: 'Estadísticas', icon: <FileText className="h-4 w-4" />, perm: 'estadisticas' },
  { id: 'sire', label: 'Registro SIRE', icon: <FileText className="h-4 w-4" />, perm: 'sire' },
  { id: 'ventasPorEmpleado', label: 'Ventas por Empleado', icon: <Users className="h-4 w-4" />, perm: 'ventasPorEmpleado' },
  { id: 'egresos', label: 'Egresos / Gastos', icon: <Calculator className="h-4 w-4" />, perm: 'egresos' },
  { id: 'clientes', label: 'Clientes', icon: <UserRound className="h-4 w-4" />, perm: 'clientes' },
  { id: 'usuarios', label: 'Usuarios', icon: <Users className="h-4 w-4" />, perm: 'usuarios' },
  { id: 'configuracion', label: 'Configuración', icon: <Settings className="h-4 w-4" />, perm: 'configuracion' },
  { id: 'auditoria', label: 'Auditoría', icon: <Shield className="h-4 w-4" />, perm: 'auditoria' },
]

export function CommandPalette({ onNavigate, tienePermiso }: { onNavigate: (seccion: string) => void; tienePermiso: (perm: string) => boolean }) {
  const [abierto, setAbierto] = React.useState(false)
  const [busqueda, setBusqueda] = React.useState('')
  const [resultados, setResultados] = React.useState<SearchResult[]>([])
  const [indiceSeleccionado, setIndiceSeleccionado] = React.useState(0)
  const [cargando, setCargando] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listaRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        e.stopPropagation()
        setAbierto((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  React.useEffect(() => {
    if (abierto) {
      setBusqueda('')
      setResultados([])
      setIndiceSeleccionado(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [abierto])

  React.useEffect(() => {
    if (!busqueda.trim()) {
      setResultados([])
      return
    }
    const q = busqueda.toLowerCase().trim()

    const pageResults: SearchResult[] = PAGES
      .filter((p) => tienePermiso(p.perm) && p.label.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        title: p.label,
        subtitle: 'Ir a página',
        type: 'page' as const,
        icon: p.icon,
        action: () => { onNavigate(p.id); setAbierto(false) },
      }))

    setResultados(pageResults)
    setIndiceSeleccionado(0)

    let cancelado = false
    const buscarDatos = async () => {
      setCargando(true)
      try {
        const [prodSnap, clientSnap] = await Promise.all([
          getDocs(query(collection(db, 'tblProductos'), limit(20))),
          getDocs(query(collection(db, 'tblClientes'), limit(20))),
        ])
        if (cancelado) return

        const nuevos: SearchResult[] = [...pageResults]

        prodSnap.forEach((doc) => {
          const d = doc.data()
          const nombre = (d.nombre || '').toLowerCase()
          const codigo = (d.codigo || '').toLowerCase()
          if (nombre.includes(q) || codigo.includes(q)) {
            nuevos.push({
              id: doc.id,
              title: d.nombre || doc.id,
              subtitle: `Producto · ${doc.id}`,
              type: 'product',
              icon: <Package className="h-4 w-4" />,
              action: () => { onNavigate('inventario'); setAbierto(false) },
            })
          }
        })

        clientSnap.forEach((doc) => {
          const d = doc.data()
          const nombre = (d.nombre || '').toLowerCase()
          const docId = (d.docN || doc.id).toLowerCase()
          if (nombre.includes(q) || docId.includes(q)) {
            nuevos.push({
              id: doc.id,
              title: d.nombre || doc.id,
              subtitle: `Cliente · ${d.docN || doc.id}`,
              type: 'client',
              icon: <UserRound className="h-4 w-4" />,
              action: () => { onNavigate('clientes'); setAbierto(false) },
            })
          }
        })

        if (!cancelado) {
          setResultados(nuevos)
          setIndiceSeleccionado(0)
        }
      } catch (e) {
        console.error('Error en búsqueda:', e)
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    const timer = setTimeout(buscarDatos, 200)
    return () => { cancelado = true; clearTimeout(timer) }
  }, [busqueda, onNavigate])

  React.useEffect(() => {
    if (!listaRef.current) return
    const items = listaRef.current.querySelectorAll('[data-result-item]')
    items[indiceSeleccionado]?.scrollIntoView({ block: 'nearest' })
  }, [indiceSeleccionado])

  const manejarTecla = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceSeleccionado((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && resultados[indiceSeleccionado]) {
      e.preventDefault()
      resultados[indiceSeleccionado].action()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAbierto(false)
    }
  }

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setAbierto(false)}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={manejarTecla}
            placeholder="Buscar productos, clientes, páginas…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">ESC</kbd>
          <button onClick={() => setAbierto(false)} className="rounded-full p-1 hover:bg-muted cursor-pointer">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div ref={listaRef} className="max-h-80 overflow-y-auto">
          {cargando && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Buscando…
            </div>
          )}

          {!cargando && busqueda.trim() && resultados.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Sin resultados para "{busqueda}"
            </div>
          )}

          {!cargando && resultados.length > 0 && (
            <div className="py-2">
              {['page', 'product', 'client'].map((tipo) => {
                const items = resultados.filter((r) => r.type === tipo)
                if (items.length === 0) return null
                const tipoLabel = tipo === 'page' ? 'Páginas' : tipo === 'product' ? 'Productos' : 'Clientes'
                return (
                  <div key={tipo}>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tipoLabel}</div>
                    {items.map((r) => {
                      const idx = resultados.indexOf(r)
                      const seleccionado = idx === indiceSeleccionado
                      return (
                        <button
                          key={`${r.type}-${r.id}`}
                          data-result-item
                          onClick={r.action}
                          onMouseEnter={() => setIndiceSeleccionado(idx)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer',
                            seleccionado ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                          )}
                        >
                          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', seleccionado ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
                            {r.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{r.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{r.subtitle}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {!busqueda.trim() && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Escribí para buscar…
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-medium">↑↓</kbd> navegar</span>
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-medium">Enter</kbd> seleccionar</span>
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-medium">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  )
}
