/**
 * **Bajar el XML y el CDR de un comprobante ya enviado a SUNAT** (03/10/2026).
 *
 * 🔑 **Por qué**: el contador pide dos cosas cuando algo no cuadra — el **XML** que se declaró y el **CDR**
 * (la constancia de que SUNAT aceptó). Hasta ahora había que pedírselos al proveedor; ahora están a un
 * clic, si el usuario tiene el permiso.
 *
 * 🔑 **No lee nada de la base**: los archivos **viajan dentro del propio comprobante** (`sunat.xml` y
 * `sunat.cdr`, en base64) y este componente recibe el documento que la pantalla ya tiene ⇒ **cero
 * consultas extra** y no hace falta ninguna regla nueva.
 *
 * ⚠️ **El permiso es `descargarXmlSunat`** (por defecto ADMIN y GERENTE, asignable por usuario en
 * `Usuarios → Editar`). Si no lo tiene, el componente **no dibuja nada**.
 * ⚠️ **Sin BOM**: un XML que empieza con BOM es inválido para los validadores de SUNAT y para varios
 * programas — el archivo tiene que salir exactamente como se declaró.
 */
import { Download, FileCheck2, FileCode2 } from 'lucide-react'

import { usePermisos } from '@/context/permisos'
import { descargarArchivo } from '@/lib/audit'
import { archivosDeDocumento, descripcionArchivo, pareceXml, type DatosUbicables } from '@/lib/archivos-sunat'
import { Button } from '@/components/ui/button'

export type DocumentoConArchivos = DatosUbicables & {
  tipoDoc?: string
  numero?: number
  sunat?: { serie?: string; numero?: number; xml?: string; cdr?: string | null } | null
}

export function DescargarArchivosSunat({ doc, ruc }: { doc: DocumentoConArchivos; ruc?: string }) {
  const { tienePermiso } = usePermisos()
  if (!tienePermiso('descargarXmlSunat')) return null

  const archivos = archivosDeDocumento({ ...doc, ruc: ruc || doc.ruc })
  if (archivos.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {archivos.map((a) => (
        <Button
          key={a.clase}
          size="sm"
          variant="outline"
          title={descripcionArchivo(a)}
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            if (!pareceXml(a.contenido)) {
              // No se baja un archivo roto sin decirlo: mejor un aviso que un XML que el contador no puede abrir.
              console.error(`❌ El archivo ${a.nombre} no parece un XML`)
              alert(`El archivo ${a.nombre} no se pudo leer bien. Avisá al soporte.`)
              return
            }
            // ⚠️ `bom: false`: el XML tiene que salir tal cual se declaró (con BOM es inválido).
            descargarArchivo(a.contenido, a.nombre, 'application/xml;charset=utf-8;', { bom: false })
          }}
        >
          {a.clase === 'cdr' ? <FileCheck2 className="mr-1 h-3.5 w-3.5" /> : <FileCode2 className="mr-1 h-3.5 w-3.5" />}
          {a.clase === 'cdr' ? 'CDR' : 'XML'}
          <Download className="ml-1 h-3 w-3 opacity-60" />
        </Button>
      ))}
    </div>
  )
}

export default DescargarArchivosSunat
