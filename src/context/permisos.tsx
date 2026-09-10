import { doc, onSnapshot } from 'firebase/firestore'
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { permisosPorRol } from '@/constants/permisos'
import { db } from '@/lib/firebase'

type Permisos = Record<string, boolean>

type PermisosValue = {
  permisos: Permisos
  rol: string | null
  nombre: string | null
  activo: boolean
  serieBoleta: string | null
  serieFactura: string | null
  seriePrefijo: string | null
  loading: boolean
  tienePermiso: (clave: string) => boolean
}

const PermisosContext = React.createContext<PermisosValue | undefined>(undefined)

export function PermisosProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [permisos, setPermisos] = React.useState<Permisos>({})
  const [rol, setRol] = React.useState<string | null>(null)
  const [nombre, setNombre] = React.useState<string | null>(null)
  const [activo, setActivo] = React.useState(true)
  const [serieBoleta, setSerieBoleta] = React.useState<string | null>(null)
  const [serieFactura, setSerieFactura] = React.useState<string | null>(null)
  const [seriePrefijo, setSeriePrefijo] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!user) {
      setPermisos({})
      setRol(null)
      setNombre(null)
      setActivo(true)
      setSerieBoleta(null)
      setSerieFactura(null)
      setSeriePrefijo(null)
      setLoading(false)
      return
    }
    setLoading(true)
    // Suscripción en vivo: si el permiso del usuario cambia (ej. se activa/desactiva
    // "estadisticas" desde Usuarios), el menú/restricciones se actualizan al instante.
    const unsub = onSnapshot(
      doc(db, 'tblUsuarios', user.uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data()
          setPermisos(d.permisos ?? {})
          setRol(d.rol ?? null)
          setNombre(d.nombre ?? null)
          setActivo(d.activo !== false)
          setSerieBoleta(d.serieBoleta ?? null)
          setSerieFactura(d.serieFactura ?? null)
          setSeriePrefijo(d.seriePrefijo ?? null)
        } else {
          setPermisos({})
          setRol(null)
          setNombre(null)
          setActivo(true)
          setSerieBoleta(null)
          setSerieFactura(null)
          setSeriePrefijo(null)
        }
        setLoading(false)
      },
      (err) => {
        console.error('❌ Error escuchando permisos:', err)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [user])

  const tienePermiso = React.useCallback((clave: string) => {
    // Si el usuario tiene el permiso explícito (true), vale. Si está en false explícito, no.
    // Si la clave NO está guardada (p. ej. permisos nuevos como 'estadisticas'), se usa
    // el default del rol, para que ADMIN/GERENTE lo vean sin migración y no afecte a la app RN.
    if (permisos[clave] === true) return true
    if (permisos[clave] === false) return false
    return permisosPorRol(rol || 'CAJERO')[clave] === true
  }, [permisos, rol])

  const value = React.useMemo(
    () => ({ permisos, rol, nombre, activo, serieBoleta, serieFactura, seriePrefijo, loading, tienePermiso }),
    [permisos, rol, nombre, activo, serieBoleta, serieFactura, seriePrefijo, loading, tienePermiso]
  )

  return <PermisosContext.Provider value={value}>{children}</PermisosContext.Provider>
}

export function usePermisos() {
  const ctx = React.useContext(PermisosContext)
  if (!ctx) throw new Error('usePermisos debe usarse dentro de <PermisosProvider>')
  return ctx
}
