import type { Turno } from '@/services/turnos'

export type DashboardWidgetId =
  | 'ventasMes'
  | 'ventasDiarias'
  | 'ventasCategoria'
  | 'topProductos'
  | 'turnoActivo'
  | 'kpis'
  | 'sunat'
  | 'accionesRapidas'
  | 'turnosCerrados'
  | 'alertaStock'
  | 'alertaVencimiento'

export type DashboardWidget = {
  id: DashboardWidgetId
  titulo: string
  visible: boolean
  orden: number
}

export const WIDGETS_POR_DEFECTO: DashboardWidget[] = [
  { id: 'turnoActivo', titulo: 'Turno Activo', visible: true, orden: 0 },
  { id: 'kpis', titulo: 'KPIs', visible: true, orden: 1 },
  { id: 'sunat', titulo: 'Comprobantes SUNAT', visible: true, orden: 2 },
  { id: 'accionesRapidas', titulo: 'Acciones Rápidas', visible: true, orden: 3 },
  { id: 'turnosCerrados', titulo: 'Turnos Cerrados', visible: true, orden: 4 },
  { id: 'alertaStock', titulo: 'Alerta Stock', visible: true, orden: 5 },
  { id: 'alertaVencimiento', titulo: 'Alerta Vencimiento', visible: true, orden: 6 },
  { id: 'ventasMes', titulo: 'Total Ventas del Mes', visible: true, orden: 7 },
  { id: 'ventasDiarias', titulo: 'Ventas Diarias', visible: true, orden: 8 },
  { id: 'ventasCategoria', titulo: 'Ventas por Categoría', visible: true, orden: 9 },
  { id: 'topProductos', titulo: 'Top de Productos', visible: true, orden: 10 },
]

export type Doc = {
  id?: string
  tipoDoc?: string
  fecha?: string
  estado?: string
  consolidado?: boolean
  venta?: {
    total?: number
    items?: {
      id?: string
      nombre?: string
      categoria?: string
      cantidad?: number
      subtotal?: number
    }[]
  }
  sunat?: { estado?: string }
  usuarioId?: string
}

export type TurnoSunat = { totalVentas?: number; ventasDelTurno?: unknown[] }

export type DashboardData = {
  activeTurno: Turno | null
  closedTurnos: TurnoSunat[]
  ventasHoy: Doc[]
  totalVentasHoy: number
  numTransacciones: number
  ticketPromedio: number
  totalVentasMes: number
  ventasMesCount: number
  sunatPendientes: number
  sunatRechazados: number
  sunatAceptados: number
  serieDiaria: {
    dias: { key: string; label: string; date: Date }[]
    tot: Record<string, number>
    max: number
    step: number
  }
  categorias: {
    arr: { nombre: string; total: number }[]
    max: number
  }
  topProductos: { nombre: string; cantidad: number; total: number }[]
  stockBajo: { id: string; nombre: string; stock: number }[]
  stockAgotado: { id: string; nombre: string; stock: number }[]
  totalProblemas: number
  proximosAVencer: { id: string; nombre: string; fechaVencimiento: string }[]
  numTurnosCerrados: number
}
