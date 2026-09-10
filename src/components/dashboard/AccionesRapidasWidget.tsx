import { ShoppingCart, Package, BarChart3, Clock } from 'lucide-react'

const PRIMARIO = '#FF6B35'
const CAMBIAR = { color: '#FF9800' }
const INVENTARIO = { color: '#4CAF50' }
const TURNOS = { color: '#9C27B0' }

type AccionProps = {
  icono: React.ReactNode
  color: string
  label: string
  seccion: string
  perm: string
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

function Accion({ icono, color, label, seccion, perm, tienePermiso, onNavigate }: AccionProps) {
  if (!tienePermiso(perm)) return null
  return (
    <button
      onClick={() => onNavigate(seccion)}
      className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: color + '1f' }}>
        <span style={{ color }}>{icono}</span>
      </div>
      <span className="text-center text-xs font-bold text-foreground">{label}</span>
    </button>
  )
}

type Props = {
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

export function AccionesRapidasWidget({ tienePermiso, onNavigate }: Props) {
  return (
    <div>
      <h2 className="mb-3 font-bold">Acciones Rápidas</h2>
      <div className="grid grid-cols-2 gap-3">
        <Accion icono={<ShoppingCart className="h-6 w-6" />} color={PRIMARIO} label="Nueva Venta" seccion="pdv" perm="ventas" tienePermiso={tienePermiso} onNavigate={onNavigate} />
        <Accion icono={<Package className="h-6 w-6" />} color={CAMBIAR.color} label="Inventario" seccion="inventario" perm="inventario" tienePermiso={tienePermiso} onNavigate={onNavigate} />
        <Accion icono={<BarChart3 className="h-6 w-6" />} color={INVENTARIO.color} label="Reportes" seccion="reportes" perm="reportes" tienePermiso={tienePermiso} onNavigate={onNavigate} />
        <Accion icono={<Clock className="h-6 w-6" />} color={TURNOS.color} label="Turnos" seccion="turnos" perm="turnos" tienePermiso={tienePermiso} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
