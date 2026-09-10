import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

const API_TOKEN = import.meta.env.VITE_APIS_PERU_TOKEN

// Resolución de base URL (orden de prioridad):
// 1) tblConfiguracion/empresa.consultaApiBase (runtime, sin redeploy)
// 2) VITE_SUNAT_API_BASE (env var, requiere rebuild)
// 3) En dev → proxy /api-sunat; en prod → api.apis.net.pe (requiere token)
const ENV_BASE = import.meta.env.VITE_SUNAT_API_BASE || (import.meta.env.DEV ? '/api-sunat' : 'https://api.apis.net.pe')

let cachedBase = ''
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min

async function getBase(): Promise<string> {
  const now = Date.now()
  if (cachedBase && now - cacheTime < CACHE_TTL) return cachedBase
  try {
    const snap = await getDoc(doc(db, 'tblConfiguracion', 'empresa'))
    if (snap.exists()) {
      const data = snap.data()
      if (data.consultaApiBase as string) {
        cachedBase = data.consultaApiBase as string
        cacheTime = now
        return cachedBase
      }
    }
  } catch {
    // Firestore no disponible, usar env
  }
  cachedBase = ENV_BASE
  cacheTime = now
  return cachedBase
}

// Si apuntamos a un endpoint propio (tblConfiguracion o VITE_SUNAT_API_BASE),
// el token lo lleva el servidor, así que NO se envía desde el navegador.
// Solo se manda cuando usamos la API directa o el proxy de Vite (ambos lo requieren).
function shouldSendToken(base: string): boolean {
  if (base.includes('amazonaws.com')) return false // Lambda propio
  if (base.startsWith('/')) return true // Proxy Vite
  return !!API_TOKEN // API directa
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consultarDni(dni: string): Promise<any | null> {
  try {
    const base = await getBase()
    const headers: Record<string, string> = shouldSendToken(base) ? { Authorization: `Bearer ${API_TOKEN}` } : {}
    const res = await fetch(`${base}/v1/dni?numero=${dni}`, { headers })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('❌ Error al consultar DNI:', e)
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consultarRuc(ruc: string): Promise<any | null> {
  try {
    const base = await getBase()
    const headers: Record<string, string> = shouldSendToken(base) ? { Authorization: `Bearer ${API_TOKEN}` } : {}
    const res = await fetch(`${base}/v1/ruc?numero=${ruc}`, { headers })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('❌ Error al consultar RUC:', e)
    return null
  }
}
