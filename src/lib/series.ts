import { CONFIG_POR_DEFECTO } from '@/constants/tributario'

/**
 * Validación de series de comprobante por caja.
 *
 * Los correlativos viven en `tblContadores` con una clave por serie:
 *   - `sunat_{serie}`     → boletas, facturas y notas de crédito/débito
 *   - `notaVenta_{serie}` → notas de venta
 *
 * Por eso dos cajas con la MISMA serie comparten contador (los correlativos se
 * intercalan y la numeración por caja sale con huecos), y una serie de usuario
 * igual a una serie de NC/ND hace que boletas y notas se numeren en el mismo
 * contador. Este módulo detecta esos choques antes de guardar.
 */

/** Campos de `tblUsuarios` que definen la serie de comprobantes de una caja. */
export type CampoSerie = 'serieBoleta' | 'serieFactura' | 'seriePrefijo'

export const CAMPOS_SERIE: readonly CampoSerie[] = ['serieBoleta', 'serieFactura', 'seriePrefijo']

export const ETIQUETA_SERIE: Record<CampoSerie, string> = {
  serieBoleta: 'boletas',
  serieFactura: 'facturas',
  seriePrefijo: 'notas de venta',
}

export type EspacioSerie = 'sunat' | 'notaVenta'

/** Espacio de numeración (contador) que usa cada campo. */
export function espacioDe(campo: CampoSerie): EspacioSerie {
  return campo === 'seriePrefijo' ? 'notaVenta' : 'sunat'
}

export type SeriesUsuario = Partial<Record<CampoSerie, string>>

/** Serie ya tomada por otro usuario de `tblUsuarios`. */
export type SerieOcupada = {
  serie: string
  campo: CampoSerie
  espacio: EspacioSerie
  usuario: string
  uid: string
  activo: boolean
}

/** Serie definida en la config de empresa (`tblConfiguracion/empresa`). */
export type SerieEmpresa = {
  serie: string
  espacio: EspacioSerie
  etiqueta: string
  /** Las series de NC/ND comparten el contador `sunat_{serie}` con boletas/facturas. */
  esNota: boolean
}

export type MotivoConflicto = 'campo_duplicado' | 'otro_usuario' | 'usuario_inactivo' | 'serie_empresa' | 'serie_nota' | 'formato'

export type ConflictoSerie = {
  campo: CampoSerie
  serie: string
  motivo: MotivoConflicto
  /** true = bloquea el guardado; false = solo aviso. */
  bloqueante: boolean
  mensaje: string
}

export function normalizarSerie(valor?: string | null): string {
  return (valor ?? '').trim().toUpperCase()
}

/** Serie de 4 caracteres que SUNAT acepta para boletas (`B`) y facturas (`F`). */
export function formatoSerieValido(campo: CampoSerie, serie: string): boolean {
  if (campo === 'serieBoleta') return /^B[A-Z0-9]{3}$/.test(serie)
  if (campo === 'serieFactura') return /^F[A-Z0-9]{3}$/.test(serie)
  return serie.length > 0
}

/** Extrae las series ocupadas por un usuario (vacío si es el usuario que se está editando). */
export function seriesDeUsuario(
  usuario: { uid?: string; nombre?: string; email?: string; activo?: boolean } & SeriesUsuario,
  excluirUid?: string
): SerieOcupada[] {
  const uid = usuario.uid ?? ''
  if (excluirUid && uid === excluirUid) return []
  const nombre = usuario.nombre || usuario.email || uid || 'usuario sin nombre'
  const activo = usuario.activo !== false
  const ocupadas: SerieOcupada[] = []
  for (const campo of CAMPOS_SERIE) {
    const serie = normalizarSerie(usuario[campo])
    if (!serie) continue
    ocupadas.push({ serie, campo, espacio: espacioDe(campo), usuario: nombre, uid, activo })
  }
  return ocupadas
}

function leerConfig(config: Record<string, unknown>, clave: string, porDefecto: string): string {
  const valor = config[clave]
  return normalizarSerie(typeof valor === 'string' ? valor : porDefecto)
}

/** Series globales de la empresa (incluye las de NC/ND, que comparten el contador SUNAT). */
export function seriesEmpresa(config: Record<string, unknown> = {}): SerieEmpresa[] {
  const c = CONFIG_POR_DEFECTO
  const series: SerieEmpresa[] = [
    { serie: leerConfig(config, 'serieBoleta', c.serieBoleta), espacio: 'sunat', etiqueta: 'serie global de boletas', esNota: false },
    { serie: leerConfig(config, 'serieFactura', c.serieFactura), espacio: 'sunat', etiqueta: 'serie global de facturas', esNota: false },
    { serie: leerConfig(config, 'serie_prefijo', c.serie_prefijo), espacio: 'notaVenta', etiqueta: 'serie global de notas de venta', esNota: false },
    { serie: leerConfig(config, 'serieBoletaNC', c.serieBoletaNC), espacio: 'sunat', etiqueta: 'serie de notas de crédito de boletas', esNota: true },
    { serie: leerConfig(config, 'serieBoletaND', c.serieBoletaND), espacio: 'sunat', etiqueta: 'serie de notas de débito de boletas', esNota: true },
    { serie: leerConfig(config, 'serieFacturaNC', c.serieFacturaNC), espacio: 'sunat', etiqueta: 'serie de notas de crédito de facturas', esNota: true },
    { serie: leerConfig(config, 'serieFacturaND', c.serieFacturaND), espacio: 'sunat', etiqueta: 'serie de notas de débito de facturas', esNota: true },
  ]
  return series.filter((s) => s.serie.length > 0)
}

/**
 * Choques entre las series que se intentan guardar y las ya existentes.
 * `bloqueante: true` = no se debe permitir guardar (dos cajas numerando en el
 * mismo contador). `bloqueante: false` = aviso (serie de un usuario inactivo,
 * igual a la global, o formato que SUNAT podría rechazar).
 */
export function validarSeries({
  series,
  ocupadas,
  empresa,
  campos,
}: {
  series: SeriesUsuario
  ocupadas: SerieOcupada[]
  empresa: SerieEmpresa[]
  campos?: readonly CampoSerie[]
}): ConflictoSerie[] {
  const conflictos: ConflictoSerie[] = []
  const propias: { campo: CampoSerie; serie: string; espacio: EspacioSerie }[] = []

  for (const campo of campos ?? CAMPOS_SERIE) {
    const serie = normalizarSerie(series[campo])
    if (!serie) continue
    const espacio = espacioDe(campo)
    const etiqueta = ETIQUETA_SERIE[campo]

    const repetida = propias.find((p) => p.serie === serie && p.espacio === espacio)
    if (repetida) {
      conflictos.push({
        campo,
        serie,
        motivo: 'campo_duplicado',
        bloqueante: true,
        mensaje: `La serie ${serie} ya está puesta en ${ETIQUETA_SERIE[repetida.campo]}; cada tipo necesita su propia serie.`,
      })
    }
    propias.push({ campo, serie, espacio })

    if (!formatoSerieValido(campo, serie)) {
      const letra = campo === 'serieBoleta' ? 'B' : 'F'
      conflictos.push({
        campo,
        serie,
        motivo: 'formato',
        bloqueante: false,
        mensaje: `SUNAT espera 4 caracteres para ${etiqueta} empezando con "${letra}" (ej. ${letra}001).`,
      })
    }

    for (const nota of empresa.filter((e) => e.esNota && e.serie === serie && e.espacio === espacio)) {
      conflictos.push({
        campo,
        serie,
        motivo: 'serie_nota',
        bloqueante: true,
        mensaje: `La serie ${serie} es la ${nota.etiqueta}: boletas/facturas y notas comparten el contador ${espacio === 'sunat' ? 'SUNAT' : 'de notas de venta'}, la numeración se pisaría.`,
      })
    }

    const global = empresa.find((e) => !e.esNota && e.serie === serie && e.espacio === espacio)
    if (global) {
      conflictos.push({
        campo,
        serie,
        motivo: 'serie_empresa',
        bloqueante: false,
        mensaje: `La serie ${serie} es la ${global.etiqueta}: las cajas sin serie propia numeran ahí, compartirían contador.`,
      })
    }

    for (const ocupada of ocupadas) {
      if (ocupada.serie !== serie || ocupada.espacio !== espacio) continue
      conflictos.push({
        campo,
        serie,
        motivo: ocupada.activo ? 'otro_usuario' : 'usuario_inactivo',
        bloqueante: ocupada.activo,
        mensaje: ocupada.activo
          ? `La serie ${serie} de ${etiqueta} ya la usa ${ocupada.usuario} en sus ${ETIQUETA_SERIE[ocupada.campo]}.`
          : `La serie ${serie} quedó registrada en ${ocupada.usuario} (usuario inactivo); reutilizarla mezcla la numeración anterior.`,
      })
    }
  }

  // Un mismo choque (p. ej. la misma serie global repetida en boletas y facturas)
  // se reporta una sola vez: el mensaje no depende del campo.
  const vistos = new Set<string>()
  return conflictos.filter((c) => {
    const clave = `${c.motivo}|${c.serie}`
    if (vistos.has(clave)) return false
    vistos.add(clave)
    return true
  })
}

export function mensajeConflictos(conflictos: ConflictoSerie[]): string {
  return conflictos.map((c) => c.mensaje).join(' ')
}

/** Series globales de la empresa, con la etiqueta que se muestra en Configuración. */
export const CAMPOS_EMPRESA: readonly { clave: string; etiqueta: string; espacio: EspacioSerie; letra: 'B' | 'F' | null }[] = [
  { clave: 'serieBoleta', etiqueta: 'Serie Boleta', espacio: 'sunat', letra: 'B' },
  { clave: 'serieFactura', etiqueta: 'Serie Factura', espacio: 'sunat', letra: 'F' },
  { clave: 'serie_prefijo', etiqueta: 'Prefijo Nota de Venta', espacio: 'notaVenta', letra: null },
  { clave: 'serieBoletaNC', etiqueta: 'Serie NC Boleta', espacio: 'sunat', letra: null },
  { clave: 'serieBoletaND', etiqueta: 'Serie ND Boleta', espacio: 'sunat', letra: null },
  { clave: 'serieFacturaNC', etiqueta: 'Serie NC Factura', espacio: 'sunat', letra: null },
  { clave: 'serieFacturaND', etiqueta: 'Serie ND Factura', espacio: 'sunat', letra: null },
]

export type MotivoConflictoEmpresa = 'duplicada' | 'formato' | 'caja_activa' | 'caja_inactiva'

export type ConflictoSerieEmpresa = {
  clave: string
  etiqueta: string
  serie: string
  motivo: MotivoConflictoEmpresa
  bloqueante: boolean
  mensaje: string
}

/**
 * Choques entre las series globales (Configuración → Empresa) y las series por
 * caja. Las cajas sin serie propia usan la global, así que una caja que declare
 * la misma serie comparte contador con la global; y una global de boletas igual
 * a una de NC/ND mezcla comprobantes y notas en `sunat_{serie}`.
 */
export function validarSeriesEmpresa({
  config,
  ocupadas,
}: {
  config: Record<string, unknown>
  ocupadas: SerieOcupada[]
}): ConflictoSerieEmpresa[] {
  const conflictos: ConflictoSerieEmpresa[] = []
  const vistas: { etiqueta: string; serie: string; espacio: EspacioSerie }[] = []

  for (const campo of CAMPOS_EMPRESA) {
    const serie = normalizarSerie(typeof config[campo.clave] === 'string' ? (config[campo.clave] as string) : '')
    if (!serie) continue

    const repetida = vistas.find((v) => v.serie === serie && v.espacio === campo.espacio)
    if (repetida) {
      conflictos.push({
        clave: campo.clave,
        etiqueta: campo.etiqueta,
        serie,
        motivo: 'duplicada',
        bloqueante: true,
        mensaje: `${campo.etiqueta} repite la serie ${serie} de ${repetida.etiqueta}: comparten el mismo contador de correlativos.`,
      })
    }
    vistas.push({ etiqueta: campo.etiqueta, serie, espacio: campo.espacio })

    if (campo.letra && !new RegExp(`^${campo.letra}[A-Z0-9]{3}$`).test(serie)) {
      conflictos.push({
        clave: campo.clave,
        etiqueta: campo.etiqueta,
        serie,
        motivo: 'formato',
        bloqueante: false,
        mensaje: `${campo.etiqueta}: SUNAT espera 4 caracteres empezando con "${campo.letra}" (ej. ${campo.letra}001).`,
      })
    }

    for (const ocupada of ocupadas) {
      if (ocupada.serie !== serie || ocupada.espacio !== campo.espacio) continue
      conflictos.push({
        clave: campo.clave,
        etiqueta: campo.etiqueta,
        serie,
        motivo: ocupada.activo ? 'caja_activa' : 'caja_inactiva',
        bloqueante: ocupada.activo,
        mensaje: `La serie ${serie} de ${campo.etiqueta} ya la usa ${ocupada.usuario} en sus ${ETIQUETA_SERIE[ocupada.campo]}: las cajas sin serie propia numerarían en el mismo contador.`,
      })
    }
  }

  const vistos = new Set<string>()
  return conflictos.filter((c) => {
    const clave = `${c.clave}|${c.serie}|${c.motivo}`
    if (vistos.has(clave)) return false
    vistos.add(clave)
    return true
  })
}
