/**
 * **¿El respaldo está corriendo?** — la regla del **latido del respaldo** (03/10/2026).
 *
 * 🔑 **Por qué existe**: el respaldo diario corre a las 23:30 en la PC del negocio. Si esa noche la PC
 * estaba apagada, **no hay copia y nadie se entera** — pasó el **01/10/2026**: el hueco se descubrió
 * mirando la carpeta a mano. La herramienta de respaldo deja ahora un documento con **cuándo corrió,
 * cuánto copió y si salió bien** (`tblRespaldoEstado/<projectId>`), y acá se decide **qué decir**.
 *
 * 🔑 Mismo criterio que el **latido del puente de Yape** (`lib/puente.ts`): los umbrales con aire,
 * porque un respaldo que se atrasa no es lo mismo que un respaldo que no está, y **`sin-datos` ≠
 * «roto»** (un cliente nuevo todavía no tiene ningún respaldo, y eso no es una alarma… pero tampoco
 * «todo bien»: es *«todavía no hay copia»*).
 */

export type EstadoRespaldoDatos = {
  fecha?: string
  ok?: boolean
  documentos?: number
  colecciones?: number
  tamanoMB?: number
  auth?: string
  segundos?: number
  error?: string
} | null

export type NivelRespaldo = 'ok' | 'atencion' | 'critico' | 'sin-datos'

export type EstadoRespaldo = {
  nivel: NivelRespaldo
  horas: number | null
  titulo: string
  detalle: string
  /** `true` cuando hay que hacer algo (se muestra en rojo o ámbar). */
  alerta: boolean
}

/** Pasadas estas horas el respaldo ya debería haber corrido (una noche + margen). */
export const HORAS_ATENCION = 36
/** Pasadas estas horas hay dos noches sin copia: acá sí hay que actuar. */
export const HORAS_CRITICO = 60

const horas = (desde: number, hasta: number) => Math.round(((hasta - desde) / 3600000) * 10) / 10

/** «hace 3 h» / «hace 2 días» — para que se entienda sin hacer cuentas. */
export function hace(horasAtras: number): string {
  if (horasAtras < 1) return 'hace minutos'
  if (horasAtras < 24) return `hace ${Math.round(horasAtras)} h`
  const dias = Math.floor(horasAtras / 24)
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

const detalleDe = (d: EstadoRespaldoDatos): string => {
  if (!d) return ''
  const partes: string[] = []
  if (d.documentos) partes.push(`${d.documentos} documentos`)
  if (d.colecciones) partes.push(`${d.colecciones} colecciones`)
  if (d.tamanoMB) partes.push(`${d.tamanoMB} MB`)
  if (d.auth === 'exportado') partes.push('con las cuentas de usuario')
  return partes.join(' · ')
}

/**
 * **Qué decir del último respaldo.** `fecha` es la del latido (ISO) y `ahora` se pasa para poder
 * probarlo sin depender del reloj.
 */
export function estadoDelRespaldo(datos: EstadoRespaldoDatos, ahora: Date = new Date()): EstadoRespaldo {
  if (!datos || !datos.fecha) {
    return {
      nivel: 'sin-datos',
      horas: null,
      titulo: 'Todavía no hay ningún respaldo registrado',
      detalle: 'Si el negocio es nuevo es normal; si ya lleva días, revisá que la tarea de la PC esté corriendo.',
      alerta: true,
    }
  }

  const t = new Date(datos.fecha).getTime()
  if (Number.isNaN(t)) {
    return { nivel: 'sin-datos', horas: null, titulo: 'El respaldo no informó una fecha válida', detalle: '', alerta: true }
  }
  const h = horas(t, ahora.getTime())
  const cuando = hace(h)
  const detalle = detalleDe(datos)

  // ⚠️ Un respaldo que **falló** es lo más grave: no hay copia nueva, aunque haya corrido.
  if (datos.ok === false) {
    return {
      nivel: 'critico',
      horas: h,
      titulo: `El último respaldo FALLÓ (${cuando})`,
      detalle: datos.error ? `Motivo: ${datos.error}` : 'No hay copia nueva desde entonces.',
      alerta: true,
    }
  }

  if (h >= HORAS_CRITICO) {
    return {
      nivel: 'critico',
      horas: h,
      titulo: `Sin respaldo desde ${cuando}`,
      detalle: `${detalle ? `${detalle}. ` : ''}Ya se perdieron dos noches de copia: revisá que la PC esté encendida a las 23:30.`,
      alerta: true,
    }
  }

  if (h >= HORAS_ATENCION) {
    return {
      nivel: 'atencion',
      horas: h,
      titulo: `El último respaldo fue ${cuando}`,
      detalle: `${detalle ? `${detalle}. ` : ''}Todavía se esperaba el de anoche: si la PC estuvo apagada, esa noche quedó sin copia.`,
      alerta: true,
    }
  }

  return {
    nivel: 'ok',
    horas: h,
    titulo: `Último respaldo: ${cuando}`,
    detalle: detalle || 'Copia completa del negocio.',
    alerta: false,
  }
}

/** Los colores, en un solo lugar (los usa la tarjeta del app). */
export const COLORES_RESPALDO: Record<NivelRespaldo, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  atencion: 'text-amber-600 dark:text-amber-400',
  critico: 'text-destructive',
  'sin-datos': 'text-muted-foreground',
}
