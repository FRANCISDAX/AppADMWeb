/**
 * El **latido del puente de Yape** (`tblPuenteYape/estado`) — Firestore.
 *
 * 🔑 **Solo se lee**: lo escribe el **celular del negocio** (`appadm-yape-puente`,
 * `Puente.latido()`), cada 5 minutos y también cada vez que manda un aviso. El web lo usa para
 * poder decir si el puente está vivo: un panel vacío significa *«no yapeó nadie»* **solo** si el
 * puente late (ver `lib/puente.ts`, donde vive la regla).
 *
 * ⚠️ **`null` no es un error**: el documento no existe cuando el puente nunca escribió (no se
 * instaló, no tiene la cuenta cargada o no tiene el permiso) y eso es un estado distinto de
 * «estaba andando y se murió».
 */
import { doc, onSnapshot } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { msDeFechaYape } from '@/lib/yape'
import type { LatidoPuenteYape } from '@/lib/puente'

/** Texto recortado de un campo opcional ('' si no vino). */
function texto(valor: unknown): string {
  return String(valor ?? '').trim()
}

/** Documento crudo → latido (aguanta los nombres viejos y los campos que todavía no existen). */
function aLatido(data: Record<string, unknown>): LatidoPuenteYape {
  const aviso = texto(data.ultimoAviso)
  const avisoEn = msDeFechaYape(data.ultimoAvisoEn ?? data.ultimo_aviso_en)
  const enviados = Number(data.avisosEnviados ?? data.avisos_enviados)
  const version = Number(data.version)
  return {
    ultimoLatido: msDeFechaYape(data.ultimoLatido ?? data.ultimo_latido ?? data.latido),
    // ⚠️ `avisosEnviados: 0` es un dato (el puente está vivo y **nunca** mandó un aviso): no se puede
    // confundir con «no sabemos», por eso se comprueba con `Number.isFinite` y no con `if (x)`.
    ...(aviso ? { ultimoAviso: aviso } : {}),
    ...(avisoEn > 0 ? { ultimoAvisoEn: avisoEn } : {}),
    ...(Number.isFinite(enviados) ? { avisosEnviados: enviados } : {}),
    ...(texto(data.dispositivo) ? { dispositivo: texto(data.dispositivo) } : {}),
    ...(texto(data.android) ? { android: texto(data.android) } : {}),
    ...(Number.isFinite(version) ? { version } : {}),
  }
}

/**
 * Escucha el latido **en vivo** (un documento, no una colección): el PDV tiene que enterarse de que
 * el puente se cayó **mientras** la caja está abierta, sin recargar nada.
 */
export function suscribirPuenteYape(
  onDatos: (latido: LatidoPuenteYape | null) => void,
  onError?: (e: Error) => void,
): () => void {
  try {
    return onSnapshot(
      doc(db, COL.PUENTE_YAPE, 'estado'),
      (snap) => onDatos(snap.exists() ? aLatido(snap.data() as Record<string, unknown>) : null),
      (e) => {
        console.warn('⚠️ Latido del puente de Yape:', e.message)
        onError?.(e)
      },
    )
  } catch (e) {
    console.warn('⚠️ No se pudo escuchar el latido del puente de Yape:', (e as Error).message)
    onError?.(e as Error)
    return () => {}
  }
}
