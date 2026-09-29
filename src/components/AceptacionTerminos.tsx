/**
 * **Aceptación de los Términos y Condiciones** (29/09/2026).
 *
 * 🔑 **Por qué existe**: el contrato con cada empresa es de **adhesión** (el mismo texto para todos) y
 * antes había que hacer firmar una carilla por cliente. Acá el **ADMIN** los acepta **una vez**, en su
 * primer ingreso, y queda registrado en la base: **quién**, **qué versión**, **cuándo** (con la hora del
 * **servidor**, no la del equipo) y **con qué huella** del texto. Es la prueba de la aceptación, y no hay
 * que perseguir a nadie.
 *
 * ⚠️ **Decisión de diseño: solo el ADMIN y solo al ADMIN le bloquea la pantalla.** El contrato lo acepta
 * el negocio (su dueño o representante), no cada empleado; y **una venta nunca se bloquea**: si algo
 * falla, el cajero sigue cobrando. Por eso el resto de los roles no ve nada.
 *
 * ⚠️ **Es de una sola dirección**: la constancia se **crea** y no se puede editar ni borrar (la regla de
 * Firestore lo impone). Si el texto cambia, se sube `VERSION_TERMINOS` y se pide una aceptación nueva;
 * la anterior queda como estaba.
 */
import * as React from 'react'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { CheckCircle2, FileText, LogOut, ShieldCheck } from 'lucide-react'

import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import {
  CLAUSULAS_TERMINOS,
  COLECCION_ACEPTACIONES,
  FECHA_TERMINOS,
  NOTA_TERMINOS,
  VERSION_TERMINOS,
  huellaTerminos,
  idAceptacion,
} from '@/lib/terminos'
import { Button } from '@/components/ui/button'

export function AceptacionTerminos() {
  const { user, logout } = useAuth()
  const { rol, nombre } = usePermisos()

  /**
   * `falta` arranca en **false** y solo se prende **con el resultado de la consulta** (asíncrono): no se
   * sincroniza con un efecto, porque eso dispara renders en cascada (`set-state-in-effect`, baseline de
   * lint del repo). Para los demás roles nunca se consulta y nunca se muestra nada.
   */
  const [falta, setFalta] = React.useState(false)
  const [leyo, setLeyo] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState('')

  const uid = user?.uid || ''
  const esAdmin = rol === 'ADMIN'

  React.useEffect(() => {
    if (!uid || !esAdmin) return
    let vivo = true
    getDoc(doc(db, COLECCION_ACEPTACIONES, idAceptacion(uid)))
      .then((snap) => {
        if (vivo) setFalta(!snap.exists())
      })
      .catch((e) => {
        // Si no se puede verificar (sin conexión, reglas), se muestra igual: el dueño lo acepta y queda
        // registrado cuando vuelva la conexión (Firestore encola la escritura).
        console.warn('⚠️ No se pudo verificar la aceptación de los términos:', e)
        if (vivo) setFalta(true)
      })
    return () => {
      vivo = false
    }
  }, [uid, esAdmin])

  async function aceptar() {
    if (!uid) return
    setGuardando(true)
    setError('')
    try {
      await setDoc(doc(db, COLECCION_ACEPTACIONES, idAceptacion(uid)), {
        version: VERSION_TERMINOS,
        fechaTerminos: FECHA_TERMINOS,
        huella: huellaTerminos(),
        uid: user?.uid || '',
        nombre: nombre || '',
        email: user?.email || '',
        rol,
        aceptadoEn: serverTimestamp(),
        // Dato de contexto: desde qué navegador se aceptó (ayuda si algún día se discute).
        navegador: typeof navigator !== 'undefined' ? String(navigator.userAgent).slice(0, 200) : '',
      })
      logActividad({
        accion: 'aceptar_terminos',
        entidad: COLECCION_ACEPTACIONES,
        entidadId: idAceptacion(uid),
        detalle: { version: VERSION_TERMINOS, huella: huellaTerminos() },
      })
      setFalta(false)
    } catch (e) {
      console.error('❌ No se pudo registrar la aceptación:', e)
      setError('No se pudo registrar la aceptación. Revisá la conexión e intentá otra vez.')
    } finally {
      setGuardando(false)
    }
  }

  if (!esAdmin || !falta) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-terminos"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-start gap-2 border-b px-4 py-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h2 id="titulo-terminos" className="font-bold">
              Términos y Condiciones de uso
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Versión <b>{VERSION_TERMINOS}</b> · {FECHA_TERMINOS} — hay que aceptarlos una sola vez
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {CLAUSULAS_TERMINOS.map((c) => (
            <div key={c.n}>
              <p className="text-xs font-bold">
                {c.n}. {c.titulo}
              </p>
              <p className="text-xs text-muted-foreground">{c.texto}</p>
            </div>
          ))}
          <p className="flex items-start gap-1 border-t pt-3 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{NOTA_TERMINOS}</span>
          </p>
        </div>

        <div className="space-y-2 border-t px-4 py-3">
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={leyo}
              onChange={(e) => setLeyo(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              He leído y <b>acepto</b> los Términos y Condiciones (versión {VERSION_TERMINOS}), en
              representación del negocio.
            </span>
          </label>
          {error && <p className="text-xs font-semibold text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => logout()} disabled={guardando}>
              <LogOut className="mr-1 h-4 w-4" /> Cerrar sesión
            </Button>
            <Button onClick={aceptar} disabled={!leyo || guardando}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {guardando ? 'Registrando…' : 'Acepto los términos'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Se registra quién aceptó, qué versión y la fecha y hora del servidor. La constancia no se
            puede editar después.
          </p>
        </div>
      </div>
    </div>
  )
}

export default AceptacionTerminos
