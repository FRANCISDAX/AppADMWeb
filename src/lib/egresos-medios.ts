/**
 * 🔑 **Con qué se paga un egreso (o si todavía no se pagó). Una sola regla.**
 *
 * 📌 **Por qué existe** (03/11/2026, decisión del usuario): *«algunos egresos no se van a tomar de caja
 * directamente, de pronto pago el dueño con su sueldo, y cuando se pague con caja se va a descontar de caja,
 * solo cuando suceda»*. Y también: *«lo que vale es la **provisión** de ese gasto o costo, aunque no se
 * pague»*.
 *
 * O sea: son **dos cosas distintas** y antes estaban mezcladas en un solo campo:
 *   1. **¿Existe el gasto?** (devengo) → **siempre** cuenta para el punto de equilibrio y los reportes.
 *   2. **¿De dónde salió la plata?** → **solo `caja`** resta del cajón, y **solo en el momento en que se
 *      marca pagado**. Un pago del dueño o una provisión **no tocan el arqueo**.
 *
 * ⚠️ **Antes había tres medios** (`caja`, `transferencia`, `otro`) y dos problemas:
 * - no existía forma de registrar un gasto **devengado y no pagado** (había que mentir con `otro` o con
 *   `transferencia`, y el arqueo/turno lo mostraban como si hubiera salido plata);
 * - un gasto que pagó el dueño **no tenía dónde ir** sin ensuciar la caja o la conciliación del banco.
 *
 * 🔑 **Regla de seguridad**: un medio **desconocido** (un documento viejo o un valor raro) **nunca toca la
 * caja** ni entra al turno. Es el mismo criterio que `bolsilloDe()` (`lib/arqueo.ts`), que ante la duda cae
 * a `'credito'` y no a efectivo: ante la duda, el cajón no se toca.
 */

export type MedioDeEgreso = 'caja' | 'transferencia' | 'otro' | 'provision' | 'dueno'

export type MedioDeEgresoInfo = {
  id: MedioDeEgreso
  label: string
  /** Texto corto para la pantalla: qué implica elegirlo. */
  ayuda: string
  /** 🔑 **El ÚNICO que resta del cajón** (y lo hace al marcar pagado). */
  tocaCaja: boolean
  /** Si es un pago del día: se registra en el turno (su lista de gastos y su total). */
  entraAlTurno: boolean
  /** Devengado y todavía **no** pagado. */
  esProvision: boolean
}

export const MEDIOS_EGRESO: readonly MedioDeEgresoInfo[] = [
  {
    id: 'caja',
    label: 'Efectivo (de la caja)',
    ayuda: 'Sale del cajón: se descuenta del arqueo del turno.',
    tocaCaja: true,
    entraAlTurno: true,
    esProvision: false,
  },
  {
    id: 'transferencia',
    label: 'Transferencia / banco',
    ayuda: 'Pagado por banco o billetera: no sale del cajón.',
    tocaCaja: false,
    entraAlTurno: true,
    esProvision: false,
  },
  {
    id: 'dueno',
    label: 'Lo pagó el dueño',
    ayuda: 'Lo pagó el dueño de su bolsillo: es gasto del mes y NO toca la caja.',
    tocaCaja: false,
    entraAlTurno: false,
    esProvision: false,
  },
  {
    id: 'provision',
    label: 'Provisión · todavía no se pagó',
    ayuda: 'Cuenta como costo del mes desde ahora. Cuando se pague, se marca y ahí sí sale del medio elegido.',
    tocaCaja: false,
    entraAlTurno: false,
    esProvision: true,
  },
  {
    id: 'otro',
    label: 'Otro',
    ayuda: 'Un pago que no es de caja ni de banco (queda registrado sin mover el arqueo).',
    tocaCaja: false,
    entraAlTurno: true,
    esProvision: false,
  },
]

/** Lo que se devuelve para un medio que no existe (o vacío): **no toca nada**. */
const DESCONOCIDO: MedioDeEgresoInfo = {
  id: 'otro',
  label: 'Medio desconocido',
  ayuda: 'El medio guardado no se reconoce: no se descuenta del cajón.',
  tocaCaja: false,
  entraAlTurno: false,
  esProvision: false,
}

const POR_ID = new Map(MEDIOS_EGRESO.map((m) => [m.id, m]))

export function infoDeMedio(medio: string | null | undefined): MedioDeEgresoInfo {
  const clave = String(medio ?? '').trim().toLowerCase() as MedioDeEgreso
  return POR_ID.get(clave) ?? DESCONOCIDO
}

/** ¿Resta del cajón? **Solo `caja`**, y solo cuando el egreso se marca pagado. */
export function tocaLaCaja(medio: string | null | undefined): boolean {
  return infoDeMedio(medio).tocaCaja
}

/** ¿Es un pago del día (va a la lista de gastos del turno)? Provisiones y pagos del dueño, no. */
export function entraAlTurno(medio: string | null | undefined): boolean {
  return infoDeMedio(medio).entraAlTurno
}

/** ¿Está devengado y todavía sin pagar? */
export function esProvision(medio: string | null | undefined): boolean {
  return infoDeMedio(medio).esProvision
}

/** La etiqueta para mostrar (en la lista, en el Excel, en los reportes). */
export function etiquetaDeMedio(medio: string | null | undefined): string {
  return infoDeMedio(medio).label
}
