const STORAGE_KEY = 'appadm-ventas-pausadas'

export type VentaPausada = {
  id: string
  fecha: string
  cart: Record<string, number>
  manualItems: Record<string, { nombre: string; precio: number; qty: number }>
  usarPromo: Record<string, boolean>
  tipoComp: 'nv' | 'boleta' | 'factura'
  metodo: 'efectivo' | 'transferencia' | 'credito' | 'mixto'
  clienteDni: string
  clienteNombre: string
  clienteDireccion: string
  cajero: string
  total: number
}

function readAll(): VentaPausada[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as VentaPausada[]
  } catch (e) {
    console.warn('[ventas-pausadas] Error leyendo localStorage, datos corruptos:', e)
    return []
  }
}

function writeAll(items: VentaPausada[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch (e) {
    console.error('[ventas-pausadas] Error guardando en localStorage:', e)
    throw new Error('No se pudo guardar la venta pausada. El almacenamiento del navegador está lleno.')
  }
}

export function listarVentasPausadas(): VentaPausada[] {
  return readAll().sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
}

export function guardarVentaPausada(data: Omit<VentaPausada, 'id' | 'fecha'>): VentaPausada {
  const all = readAll()
  const entry: VentaPausada = {
    ...data,
    id: `pausada-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fecha: new Date().toISOString(),
  }
  all.push(entry)
  writeAll(all)
  return entry
}

export function eliminarVentaPausada(id: string): void {
  writeAll(readAll().filter((v) => v.id !== id))
}

export function cantidadVentasPausadas(): number {
  return readAll().length
}
