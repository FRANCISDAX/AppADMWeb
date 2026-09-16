import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/auth.tsx'
import { PermisosProvider } from './context/permisos.tsx'
import { NotificationsProvider } from './components/notifications.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { instalarCapturaGlobal } from './lib/errores.ts'
import { registrarError } from './services/errores.ts'

// Errores que no pasan por React (excepciones sueltas y promesas sin catch):
// sin esto se perdían en la consola del navegador y nadie se enteraba.
instalarCapturaGlobal((error, contexto, detalle) => {
  void registrarError(error, contexto, detalle)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary contexto="app">
      <AuthProvider>
        <PermisosProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </PermisosProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>
)
