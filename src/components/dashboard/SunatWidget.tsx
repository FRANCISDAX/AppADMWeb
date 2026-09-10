import { CloudUpload, ChevronRight } from 'lucide-react'

type Props = {
  sunatPendientes: number
  sunatRechazados: number
  sunatAceptados: number
  tienePermiso: (perm: string) => boolean
  onNavigate: (seccion: string) => void
}

export function SunatWidget({ sunatPendientes, sunatRechazados, sunatAceptados, tienePermiso, onNavigate }: Props) {
  const hayDatos = sunatPendientes > 0 || sunatRechazados > 0 || sunatAceptados > 0
  if (!tienePermiso('registroVentas') || !hayDatos) return null

  return (
    <>
      <button
        onClick={() => onNavigate('reportes')}
        className="flex w-full items-center justify-between rounded-2xl border bg-card p-4 shadow-card transition-all hover:bg-muted/40 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-primary" />
          <span className="font-bold">Comprobantes SUNAT</span>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>
      <div className="grid grid-cols-3 gap-2">
        {sunatPendientes > 0 && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {sunatPendientes} pendiente{sunatPendientes !== 1 ? 's' : ''}
          </div>
        )}
        {sunatRechazados > 0 && (
          <div className="rounded-xl bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {sunatRechazados} rechazado{sunatRechazados !== 1 ? 's' : ''}
          </div>
        )}
        {sunatAceptados > 0 && (
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {sunatAceptados} aceptado{sunatAceptados !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </>
  )
}
