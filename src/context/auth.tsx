import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import * as React from 'react'
import { auth, db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

type AuthContextValue = {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

function obtenerDeviceId(): string {
  let id = localStorage.getItem('appadm_device_id')
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem('appadm_device_id', id)
  }
  return id
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [sesionEnOtro, setSesionEnOtro] = React.useState(false)
  const registradoRef = React.useRef(false)

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
      if (!u) setSesionEnOtro(false)
    })
    return unsub
  }, [])

  React.useEffect(() => {
    if (!user) return
    let unsubSnap: (() => void) | null = null
    let activo = true
    registradoRef.current = false
    const deviceId = obtenerDeviceId()
    const usuarioRef = doc(db, 'tblUsuarios', user.uid)
    const sesionEnOtroRef = { current: false }

    const registrar = async () => {
      await setDoc(usuarioRef, { activeSession: { deviceId, at: new Date().toISOString() } }, { merge: true })
      registradoRef.current = true
    }

    const vigilar = () => {
      unsubSnap = onSnapshot(usuarioRef, (s) => {
        const a = s.data()?.activeSession
        if (a && a.deviceId && a.deviceId !== deviceId) {
          if (registradoRef.current) {
            signOut(auth)
          } else if (!sesionEnOtroRef.current) {
            sesionEnOtroRef.current = true
            setSesionEnOtro(true)
          }
        }
      })
    }

    ;(async () => {
      try {
        const snap = await getDoc(usuarioRef)
        if (!activo) return
        const sd = snap.data()
        const active = sd?.activeSession
        if (active && active.deviceId && active.deviceId !== deviceId) {
          sesionEnOtroRef.current = true
          setSesionEnOtro(true)
          vigilar()
        } else {
          await registrar()
          vigilar()
        }
      } catch (e) {
        console.error('❌ Error verificando sesión:', e)
      }
    })()

    return () => {
      activo = false
      if (unsubSnap) unsubSnap()
      setSesionEnOtro(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const continuarAqui = React.useCallback(async () => {
    if (!user) return
    await setDoc(doc(db, 'tblUsuarios', user.uid), { activeSession: { deviceId: obtenerDeviceId(), at: new Date().toISOString() } }, { merge: true })
    registradoRef.current = true
    setSesionEnOtro(false)
  }, [user])

  const logout = React.useCallback(async () => {
    await signOut(auth)
  }, [])

  const value = React.useMemo(() => ({ user, loading, logout }), [user, loading, logout])

  return (
    <AuthContext.Provider value={value}>
      {children}

      {sesionEnOtro && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-3xl">⚠️</div>
            <h2 className="text-lg font-extrabold">Sesión en otro dispositivo</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta cuenta ya está activa en otro dispositivo. Si continuás acá, se cerrará la sesión del otro dispositivo.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={logout}>Cerrar sesión</Button>
              <Button className="flex-1" onClick={continuarAqui}>Continuar aquí</Button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
