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
export type CampoSerie =
  | 'serieBoleta'
  | 'serieFactura'
  | 'seriePrefijo'
  | 'serieBoletaNC'
  | 'serieBoletaND'
  | 'serieFacturaNC'
  | 'serieFacturaND'

export const CAMPOS_SERIE: readonly CampoSerie[] = [
  'serieBoleta',
  'serieFactura',
  'seriePrefijo',
  'serieBoletaNC',
  'serieBoletaND',
  'serieFacturaNC',
  'serieFacturaND',
]

export const ETIQUETA_SERIE: Record<CampoSerie, string> = {
  serieBoleta: 'boletas',
  serieFactura: 'facturas',
  seriePrefijo: 'notas de venta',
  serieBoletaNC: 'notas de crédito de boletas',
  serieBoletaND: 'notas de débito de boletas',
  serieFacturaNC: 'notas de crédito de facturas',
  serieFacturaND: 'notas de débito de facturas',
}

/** Campos cuyo comprobante es una nota de crédito/débito. */
export const esCampoNota = (campo: CampoSerie): boolean => campo.startsWith('serieBoletaN') || campo.startsWith('serieFacturaN')

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
  /** Campo de `tblUsuarios` del que esta serie es el respaldo cuando está vacío. */
  campo: CampoSerie
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
  if (campo === 'serieBoleta' || campo === 'serieBoletaNC' || campo === 'serieBoletaND') return /^B[A-Z0-9]{3}$/.test(serie)
  if (campo === 'serieFactura' || campo === 'serieFacturaNC' || campo === 'serieFacturaND') return /^F[A-Z0-9]{3}$/.test(serie)
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
    { serie: leerConfig(config, 'serieBoleta', c.serieBoleta), espacio: 'sunat', etiqueta: 'serie global de boletas', esNota: false, campo: 'serieBoleta' },
    { serie: leerConfig(config, 'serieFactura', c.serieFactura), espacio: 'sunat', etiqueta: 'serie global de facturas', esNota: false, campo: 'serieFactura' },
    { serie: leerConfig(config, 'serie_prefijo', c.serie_prefijo), espacio: 'notaVenta', etiqueta: 'serie global de notas de venta', esNota: false, campo: 'seriePrefijo' },
    { serie: leerConfig(config, 'serieBoletaNC', c.serieBoletaNC), espacio: 'sunat', etiqueta: 'serie de notas de crédito de boletas', esNota: true, campo: 'serieBoletaNC' },
    { serie: leerConfig(config, 'serieBoletaND', c.serieBoletaND), espacio: 'sunat', etiqueta: 'serie de notas de débito de boletas', esNota: true, campo: 'serieBoletaND' },
    { serie: leerConfig(config, 'serieFacturaNC', c.serieFacturaNC), espacio: 'sunat', etiqueta: 'serie de notas de crédito de facturas', esNota: true, campo: 'serieFacturaNC' },
    { serie: leerConfig(config, 'serieFacturaND', c.serieFacturaND), espacio: 'sunat', etiqueta: 'serie de notas de débito de facturas', esNota: true, campo: 'serieFacturaND' },
  ]
  return series.filter((s) => s.serie.length > 0)
}

/**
 * Serie con la que la caja emitirá cada tipo: la propia si la definió, si no la
 * global de la empresa. Es lo que realmente se numera, así que los choques se
 * calculan sobre este conjunto (no sobre lo declarado).
 */
export function seriesEfectivas(series: SeriesUsuario, empresa: SerieEmpresa[]): { campo: CampoSerie; serie: string; espacio: EspacioSerie; declarada: boolean }[] {
  return CAMPOS_SERIE.map((campo) => {
    const propia = normalizarSerie(series[campo])
    const global = empresa.find((e) => e.campo === campo)?.serie ?? ''
    return { campo, serie: propia || global, espacio: espacioDe(campo), declarada: propia.length > 0 }
  }).filter((s) => s.serie.length > 0)
}

/**
 * Choques entre las series que se intentan guardar y las ya existentes.
 *
 * Se calcula sobre las series **efectivas** (la propia de la caja o, si está
 * vacía, la global): una caja que deja las notas en blanco emite con la serie
 * global de NC/ND, así que una boleta con esa misma serie sí comparte contador.
 * `bloqueante: true` = no se debe permitir guardar. `bloqueante: false` = aviso.
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
  const revisar = campos ? new Set<CampoSerie>(campos) : null
  const efectivas = seriesEfectivas(series, empresa)

  for (const efectiva of efectivas) {
    const { campo, serie, espacio, declarada } = efectiva
    // Solo interesa lo que el usuario declara aquí (un campo heredado se valida
    // como parte del conjunto efectivo, no contra otros usuarios).
    if (revisar && !revisar.has(campo)) continue
    const etiqueta = ETIQUETA_SERIE[campo]

    if (declarada) {
      // 1) La serie declarada choca con otra serie EFECTIVA de la misma caja
      //    (declarada por ella o heredada de la global de empresa).
      const choque = efectivas.find((e) => e.campo !== campo && e.serie === serie && e.espacio === espacio)
      if (choque) {
        conflictos.push({
          campo,
          serie,
          motivo: choque.declarada ? 'campo_duplicado' : 'serie_nota',
          bloqueante: true,
          mensaje: choque.declarada
            ? `La serie ${serie} está en ${etiqueta} y en ${ETIQUETA_SERIE[choque.campo]}: cada tipo necesita su propia serie.`
            : `La serie ${serie} en ${etiqueta} es la que esta caja ya usa en ${ETIQUETA_SERIE[choque.campo]} (serie global de empresa): comparten el mismo contador.`,
        })
      }

      // 2) La serie declarada es EXACTAMENTE la global del mismo campo: hoy no
      //    rompe nada (es lo que heredaría), pero conviene que sea explícito.
      const global = empresa.find((e) => e.campo === campo && e.serie === serie)
      if (global) {
        conflictos.push({
          campo,
          serie,
          motivo: 'serie_empresa',
          bloqueante: false,
          mensaje: `La serie ${serie} de ${etiqueta} es la misma ${global.etiqueta}: las cajas sin serie propia numeran ahí, compartirían contador.`,
        })
      }

      if (!formatoSerieValido(campo, serie)) {
        const letra = campo.startsWith('serieFactura') ? 'F' : 'B'
        conflictos.push({
          campo,
          serie,
          motivo: 'formato',
          bloqueante: false,
          mensaje: `SUNAT espera 4 caracteres para ${etiqueta} empezando con "${letra}" (ej. ${letra}001).`,
        })
      }
    }

    // 3) Choque con la misma serie declarada por otra caja.
    for (const ocupada of ocupadas) {
      if (ocupada.serie !== serie || ocupada.espacio !== espacio) continue
      if (!declarada && ocupada.activo) continue // ambas heredan la global: es lo esperado
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

  // Un mismo choque se reporta una sola vez: el mensaje no depende del campo.
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
