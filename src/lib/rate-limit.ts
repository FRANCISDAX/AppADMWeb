/**
 * Rate limiting manual para operaciones críticas.
 * Usa un Map en memoria — se resetea al recargar la página.
 * Límites configurables por acción.
 */

type RateConfig = {
  maxOps: number       // máximo número de operaciones...
  ventanaMs: number    // ...en este período de tiempo
}

const DEFAULT: RateConfig = { maxOps: 30, ventanaMs: 60_000 }

const CONFIGS: Record<string, RateConfig> = {
  crear_venta:        { maxOps: 20, ventanaMs: 60_000 },
  emitir_boleta:      { maxOps: 20, ventanaMs: 60_000 },
  emitir_factura:     { maxOps: 20, ventanaMs: 60_000 },
  anular_documento:   { maxOps: 10, ventanaMs: 60_000 },
  crear_egreso:       { maxOps: 30, ventanaMs: 60_000 },
  eliminar_egreso:    { maxOps: 10, ventanaMs: 60_000 },
  abrir_turno:        { maxOps: 5,  ventanaMs: 300_000 },
  cerrar_turno:       { maxOps: 5,  ventanaMs: 300_000 },
  ajuste_stock:       { maxOps: 15, ventanaMs: 60_000 },
  toma_inventario:    { maxOps: 5,  ventanaMs: 300_000 },
  crear_producto:     { maxOps: 20, ventanaMs: 60_000 },
  editar_producto:    { maxOps: 40, ventanaMs: 60_000 },
  eliminar_producto:  { maxOps: 10, ventanaMs: 60_000 },
}

// Registro de timestamps por acción: { accion: [timestamp1, timestamp2, ...] }
const REGISTRO = new Map<string, number[]>()

/**
 * Verifica si la acción excede el límite.
 * Si NO excede, registra la operación y retorna null.
 * Si SÍ excede, retorna el mensaje de error.
 */
export function verificarRateLimit(accion: string): string | null {
  const ahora = Date.now()
  const config = CONFIGS[accion] || DEFAULT

  // Limpiar registros fuera de la ventana
  const registros = (REGISTRO.get(accion) || []).filter((t) => ahora - t < config.ventanaMs)
  REGISTRO.set(accion, registros)

  if (registros.length >= config.maxOps) {
    const segundos = Math.ceil(config.ventanaMs / 1000)
    return `Demasiadas operaciones de "${accion}". Esperá ${segundos} segundos.`
  }

  registros.push(ahora)
  return null
}

/**
 * Lanza error si se excede el rate limit. Usar al inicio de operaciones críticas.
 */
export function exigirRateLimit(accion: string): void {
  const error = verificarRateLimit(accion)
  if (error) throw new Error(error)
}
