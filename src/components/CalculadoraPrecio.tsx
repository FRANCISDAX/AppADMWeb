/**
 * **Calculadora de precio de venta** (formulario de producto).
 *
 * 🔑 **Por qué existe**: el precio de venta no se adivina. El camino es *costo → margen que se quiere
 * ganar → precio final*, y es la cuenta que ofrecen todas las apps del rubro. Hasta ahora el sistema
 * **reportaba** el margen (Estadísticas, utilidad) pero no dejaba **decidir** el precio desde él: el
 * usuario escribía un precio y no sabía si dejaba 12% o 40%.
 *
 * 🔑 **La aritmética NO vive acá**: está en **`lib/precio-venta.ts`** (pura y testeada), la misma que
 * usan los informes para medir el margen. Este componente solo dibuja y, si el usuario lo aprueba,
 * aplica el precio al formulario (`onUsar`). **Nunca cambia el precio por su cuenta.**
 *
 * ⚠️ **El precio del producto es FINAL al público** (invariante del sistema): incluye el IGV y es el que
 * está en la etiqueta. Con un producto **gravado** el margen se mide **sin IGV** —el IGV no es plata del
 * negocio— y el precio sugerido **ya lo incluye** (no se recarga recién al cobrar). En esta región el
 * catálogo es exonerado (`'20'`), así que hoy la cuenta es directa; el aviso aparece solo si el producto
 * lleva IGV.
 */
import * as React from 'react'
import { Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  REDONDEOS,
  margenDePrecio,
  precioDesdeMargen,
  type BaseMargen,
  type RedondeoPrecio,
} from '@/lib/precio-venta'
import { fmt } from '@/lib/ui-utils'

const pct = (n: number) => `${n.toFixed(1)}%`

export function CalculadoraPrecio({
  costo,
  afectacion,
  precioActual,
  onUsar,
}: {
  /** Costo por **unidad base** con el que se calcula (lo que se escribió en la compra, o el del sistema). */
  costo: number
  /** Afectación del producto (`'10'` = gravado, `'20'`/`'30'` = sin IGV). */
  afectacion: string
  /** El precio de venta que hay escrito ahora en el formulario. */
  precioActual: number
  /** Aplica el precio sugerido al formulario. */
  onUsar: (precio: number) => void
}) {
  const [margenTexto, setMargenTexto] = React.useState('30')
  const [base, setBase] = React.useState<BaseMargen>('precio')
  const [redondeo, setRedondeo] = React.useState<RedondeoPrecio>('exacto')

  const margen = Number(String(margenTexto).replace(',', '.')) || 0
  const sugerido = precioDesdeMargen(costo, { margenPct: margen, base, afectacion, redondeo })
  const actual = margenDePrecio(precioActual, costo, afectacion)
  const hayCosto = costo > 0
  const aPerdida = hayCosto && precioActual > 0 && actual.margen < 0

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Calculator className="h-3.5 w-3.5 text-primary" /> Calculadora de precio de venta
        </span>
        <span className="text-[11px] text-muted-foreground">
          {hayCosto ? `Costo por unidad: ${fmt(costo)}` : 'Sin costo cargado'}
        </span>
      </div>

      {!hayCosto ? (
        <p className="text-[11px] text-muted-foreground">
          Carga el <strong>precio de compra</strong> (o registra una compra) para poder calcular el margen.
          El costo es la base de todo el cálculo.
        </p>
      ) : (
        <>
          {/* Lo que deja el precio que ya está escrito: el número que hoy no se veía en ningún lado. */}
          {precioActual > 0 && (
            <p className={aPerdida ? 'text-[11px] font-semibold text-destructive' : 'text-[11px] text-muted-foreground'}>
              {aPerdida ? '⚠️ El precio actual vende ' : 'El precio actual deja '}
              <strong>{pct(actual.margenPct)}</strong> de margen
              {actual.gravado ? ' (sobre el precio sin IGV)' : ''} · {pct(actual.markupPct)} sobre el costo
              {aPerdida ? ` · pierdes ${fmt(Math.abs(actual.margen))} por unidad` : ''}
            </p>
          )}

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-[11px]">Margen que quieres ganar</Label>
              <div className="mt-0.5 flex items-center gap-1">
                <Input
                  value={margenTexto}
                  onChange={(e) => setMargenTexto(e.target.value)}
                  inputMode="decimal"
                  className="h-8 w-20 text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Medido sobre</Label>
              <select
                value={base}
                onChange={(e) => setBase(e.target.value as BaseMargen)}
                className="mt-0.5 h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
              >
                <option value="precio">el precio de venta (margen)</option>
                <option value="costo">el costo (markup)</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px]">Redondeo</Label>
              <select
                value={redondeo}
                onChange={(e) => setRedondeo(e.target.value as RedondeoPrecio)}
                className="mt-0.5 h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
              >
                {REDONDEOS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {sugerido === null ? (
              <span className="text-[11px] text-muted-foreground">
                Con un {pct(margen)} sobre el precio de venta la cuenta no existe: para que quede algo, el
                margen tiene que ser menor a 100%.
              </span>
            ) : (
              <>
                <span className="text-xs">
                  Precio sugerido: <strong className="text-base">{fmt(sugerido)}</strong>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={Math.abs(sugerido - precioActual) < 0.005}
                  onClick={() => onUsar(sugerido)}
                >
                  {Math.abs(sugerido - precioActual) < 0.005 ? 'Es el precio actual' : `Usar ${fmt(sugerido)}`}
                </Button>
              </>
            )}
          </div>

          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {base === 'precio'
              ? `«Margen sobre el precio» = costo ÷ (1 − ${pct(margen)}): es la parte de lo que cobras que queda como ganancia.`
              : `«Sobre el costo» (markup) = costo × (1 + ${pct(margen)}): es el recargo que le aplicas a lo que te costó.`}
            {' '}El redondeo siempre sube: el margen que pides es un piso, nunca un techo.
          </p>
          {actual.gravado && (
            <p className="mt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              ⚠️ Este producto lleva IGV: el margen se mide sobre el precio <strong>sin IGV</strong> y el
              precio sugerido ya lo incluye.
            </p>
          )}
        </>
      )}
    </div>
  )
}
