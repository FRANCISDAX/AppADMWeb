/**
 * **Exportar los datos del negocio** (Firestore) — la parte del app de la exportación.
 *
 * 🔑 **Cómo se lee**: colección por colección, **tolerando que alguna falle**. No es un detalle: el
 * export lo puede pedir un **GERENTE**, y hay colecciones que un GERENTE no puede listar (por ejemplo
 * la constancia de aceptación de los Términos, que es de ADMIN). Antes que devolver un error y no
 * exportar **nada**, se exporta todo lo demás y **se dice qué quedó afuera y por qué** — un archivo
 * incompleto que avisa es mejor que una pantalla de error.
 *
 * ⚠️ Una colección **vacía** no es un error: se exporta igual (con su encabezado), para que el que mira
 * el Excel sepa que existe y no tiene datos.
 */
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COLECCIONES_EXPORTABLES, type DocumentoExportable, type HojaExportable } from '@/lib/exportacion'

export type ResultadoLectura = {
  hojas: HojaExportable[]
  /** Colecciones que **no** se pudieron leer, con el motivo (normalmente: sin permiso). */
  omitidas: { coleccion: string; motivo: string }[]
  documentos: number
}

/** Lee **todas** las colecciones del negocio. Solo lectura. */
export async function leerTodoParaExportar(
  onProgreso?: (hecho: number, total: number, coleccion: string) => void,
): Promise<ResultadoLectura> {
  const hojas: HojaExportable[] = []
  const omitidas: { coleccion: string; motivo: string }[] = []
  let documentos = 0

  for (let i = 0; i < COLECCIONES_EXPORTABLES.length; i++) {
    const nombre = COLECCIONES_EXPORTABLES[i]
    onProgreso?.(i, COLECCIONES_EXPORTABLES.length, nombre)
    try {
      const snap = await getDocs(collection(db, nombre))
      const docs: DocumentoExportable[] = snap.docs.map((d) => ({ id: d.id, datos: d.data() as Record<string, unknown> }))
      hojas.push({ coleccion: nombre, documentos: docs })
      documentos += docs.length
    } catch (e) {
      omitidas.push({ coleccion: nombre, motivo: e instanceof Error ? e.message : String(e) })
      console.warn(`⚠️ No se pudo exportar ${nombre}:`, e)
    }
  }

  onProgreso?.(COLECCIONES_EXPORTABLES.length, COLECCIONES_EXPORTABLES.length, 'listo')
  return { hojas, omitidas, documentos }
}
