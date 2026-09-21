import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}

if (!firebaseConfig.apiKey) {
  console.error('❌ Faltan las variables VITE_FIREBASE_* en .env.local')
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
void setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.error('❌ Error al configurar persistencia de sesión:', e)
})

// Firestore con caché local: permite consultar productos/clientes sin internet.
// Las escrituras (ventas, turnos) requieren conexión.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

/**
 * 🔌 **Modo EMULADOR (solo desarrollo)** — para probar la app con un catálogo grande y varias cajas
 * **sin tocar la base real**: se activa con `VITE_USE_EMULATOR=1` en `.env.local` y un
 * `VITE_FIREBASE_PROJECT_ID` que empiece con `demo-` (los proyectos demo no existen en la nube).
 *
 * ⚠️ **Dos candados**: `import.meta.env.DEV` es `false` en el build de producción, así que Vite borra
 * este bloque y **lo desplegado no puede** apuntar a un emulador; y con el project id `demo-…`, si el
 * hook no se aplicara, el cliente intentaría escribir en un proyecto **inexistente** (nunca en el real).
 *
 * Se usa con: `npx firebase emulators:start --only firestore,auth --project demo-appadm`.
 */
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  console.warn('🔌 MODO EMULADOR: Firestore 127.0.0.1:8080 · Auth 127.0.0.1:9099 (solo desarrollo)')
}
