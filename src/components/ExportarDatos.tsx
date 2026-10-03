/**
 * **Exportar todos los datos del negocio** (Configuración / Reportes → *Mis Datos*).
 *
 * 🔑 **Para qué**: es la puerta que ve el cliente — *«tus datos son tuyos y los bajás cuando quieras»* —
 * y lo que hace creíble la promesa del contrato (al terminar se entrega **toda** la información en
 * formato abierto). Antes había que correr un script en la PC del proveedor.
 *
 * 🔑 **Quién**: **ADMIN y GERENTE** (decisión del usuario, 03/10/2026). Un botón que baja toda la base es
 * una herramienta de fuga: por eso **queda registrado en la auditoría** quién lo usó — eso es lo que
 * disuade — y por eso no está para cajeros ni vendedores.
 *
 * ⚠️ **Se lee una sola vez y después se baja lo que se quiera**: primero se prepara (y se ve el resumen
 * de qué hay), después se bajan el **Excel** (una hoja por colección) y el **JSON** (para sistemas). Dos
 * descargas automáticas de un mismo clic las bloquea el navegador.
 */
import * as React from 'react'
import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, FileJson, Loader2 } from 'lucide-react'

import { useConfiguracion } from '@/hooks/use-configuracion'
import { usePermisos } from '@/context/permisos'
import { descargarArchivo, logActividad } from '@/lib/audit'
import { exportarExcel } from '@/lib/excel'
import {
  aCSV,
  filasDe,
  legible,
  nombreDeArchivoExportacion,
  nombreDeHoja,
  resumenDeHojas,
  type HojaExportable,
} from '@/lib/exportacion'
import { leerTodoParaExportar, type ResultadoLectura } from '@/services/exportacion'
import { Button } from '@/components/ui/button'

export function ExportarDatos() {
  const { rol } = usePermisos()
  const { config } = useConfiguracion()
  const [conFotos, setConFotos] = React.useState(false)
  const [preparando, setPreparando] = React.useState(false)
  const [progreso, setProgreso] = React.useState('')
  const [datos, setDatos] = React.useState<ResultadoLectura | null>(null)
  const [error, setError] = React.useState('')

  const negocio = config?.nombre || 'Mi negocio'
  const puede = rol === 'ADMIN' || rol === 'GERENTE'
  if (!puede) return null

  /** Paso 1: leer todo (una vez). */
  async function preparar() {
    setPreparando(true)
    setError('')
    setDatos(null)
    try {
      const r = await leerTodoParaExportar((hecho, total, coleccion) =>
        setProgreso(`Leyendo ${hecho} de ${total}${coleccion ? `: ${coleccion}` : ''}`),
      )
      setDatos(r)
      // 🔑 Queda en la auditoría: un botón que baja toda la base tiene que dejar rastro de quién lo usó.
      logActividad({
        accion: 'exportar_datos',
        entidad: 'datos',
        entidadId: `exportacion-${new Date().toISOString().slice(0, 10)}`,
        detalle: { documentos: r.documentos, colecciones: r.hojas.length, omitidas: r.omitidas.length, conFotos },
      })
    } catch (e) {
      console.error('❌ No se pudo preparar la exportación:', e)
      setError('No se pudieron leer los datos. Revisá la conexión e intentá otra vez.')
    } finally {
      setPreparando(false)
      setProgreso('')
    }
  }

  /** Paso 2a: el Excel, una hoja por colección. */
  async function bajarExcel() {
    if (!datos) return
    setError('')
    try {
      const hojas = datos.hojas.map((h) => {
        const { columnas, filas } = filasDe(h, { paraPlanilla: true, conFotos })
        return { name: nombreDeHoja(h.coleccion), headers: columnas, rows: filas }
      })
      await exportarExcel(hojas, nombreDeArchivoExportacion(negocio, new Date(), 'xlsx'), {
        empresa: negocio,
        titulo: 'Exportación de datos',
      })
    } catch (e) {
      // ⚠️ Sin esto, un fallo al armar el archivo no decía **nada**: el botón parecía no hacer nada.
      console.error('❌ No se pudo generar el Excel:', e)
      setError('No se pudo generar el Excel. Probá con «sin fotos» o avisá al soporte.')
    }
  }

  /** Paso 2b: el JSON completo (copia fiel, para un sistema o para archivarla). */
  function bajarJSON() {
    if (!datos) return
    setError('')
    try {
      const cuerpo = {
        negocio,
        ruc: config?.ruc || '',
        exportadoEn: new Date().toISOString(),
        conFotos,
        colecciones: Object.fromEntries(
          datos.hojas.map((h) => [
            h.coleccion,
            h.documentos.map((d) => ({ id: d.id, ...(legible(d.datos, { paraPlanilla: false }) as Record<string, unknown>) })),
          ]),
        ),
        noExportadas: datos.omitidas,
      }
      descargarArchivo(
        JSON.stringify(cuerpo, null, 2),
        nombreDeArchivoExportacion(negocio, new Date(), 'json'),
        'application/json;charset=utf-8;',
        // ⚠️ **Sin BOM**: un JSON con BOM es inválido para cualquier parseador (`JSON.parse` lo rechaza).
        { bom: false },
      )
    } catch (e) {
      console.error('❌ No se pudo generar el JSON:', e)
      setError('No se pudo generar el JSON. Avisá al soporte.')
    }
  }

  /** El CSV de una colección suelta (para quien quiere una planilla simple). */
  function bajarCSV(hoja: HojaExportable) {
    setError('')
    try {
      const { columnas, filas } = filasDe(hoja, { paraPlanilla: true, conFotos })
      descargarArchivo(aCSV(columnas, filas), `${hoja.coleccion}.csv`)
    } catch (e) {
      console.error('❌ No se pudo generar el CSV:', e)
      setError('No se pudo generar el CSV.')
    }
  }

  const resumen = datos ? resumenDeHojas(datos.hojas) : []

  return (
    <div className="rounded-xl border bg-card p-4 shadow-soft">
      <div className="mb-2 flex items-start gap-2">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h3 className="font-bold">Mis Datos</h3>
          <p className="text-xs text-muted-foreground">
            Bajá <b>toda</b> la información del negocio (ventas, productos, clientes, caja, movimientos…)
            en un Excel con una hoja por colección y en un archivo JSON. Es tu información: podés
            llevártela cuando quieras.
          </p>
        </div>
      </div>

      <label className="mb-3 flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={conFotos}
          onChange={(e) => setConFotos(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          Incluir las <b>fotos del catálogo</b>. Sin esto la exportación pesa ~1 MB y sale al instante; con
          las fotos pesa decenas de MB.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={preparar} disabled={preparando} size="sm">
          {preparando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />}
          {preparando ? 'Leyendo…' : datos ? 'Volver a leer' : 'Preparar la exportación'}
        </Button>
        {datos && (
          <>
            <Button onClick={bajarExcel} size="sm" variant="outline">
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel (una hoja por colección)
            </Button>
            <Button onClick={bajarJSON} size="sm" variant="outline">
              <FileJson className="mr-1 h-4 w-4" /> JSON completo
            </Button>
          </>
        )}
        {progreso && <span className="text-xs text-muted-foreground">{progreso}</span>}
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {datos && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Listo: {datos.documentos} registros en {datos.hojas.length} colecciones.
          </p>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {resumen.map((r) => (
                  <tr key={r.coleccion} className="border-b last:border-0">
                    <td className="py-0.5 pr-2 font-mono">{r.coleccion}</td>
                    <td className="py-0.5 pr-2 text-right num">{r.documentos}</td>
                    <td className="py-0.5 text-right">
                      <button onClick={() => bajarCSV(datos.hojas.find((h) => h.coleccion === r.coleccion) as HojaExportable)} className="cursor-pointer text-primary underline">
                        CSV
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.omitidas.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <p className="font-semibold">
                ⚠️ {datos.omitidas.length} colección(es) no se pudieron exportar (normalmente por permisos de tu rol):
              </p>
              <ul className="ml-4 list-disc">
                {datos.omitidas.map((o) => (
                  <li key={o.coleccion}>
                    <span className="font-mono">{o.coleccion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            La exportación queda registrada en la <b>auditoría</b> (quién y cuándo). Las contraseñas de los
            usuarios <b>no</b> se incluyen: no son un dato exportable.
          </p>
        </div>
      )}
    </div>
  )
}

export default ExportarDatos
