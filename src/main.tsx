import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RutaPedidoPublico } from '@/pages/PedidoPublico-ruta'
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

/**
 * 🔑 **El link público (`/pedido`) se monta ANTES de los providers**: lo abre un cliente desde su celular, sin
 * sesión ni permisos, y baja **una foto** del catálogo (`/catalogo.json`) para armar un mensaje de WhatsApp.
 * ⚠️ **Ni Firebase ni el login entran en esa rama**: el app de adentro queda exactamente igual.
 */
const esPedidoPublico = /^\/pedido\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary contexto={esPedidoPublico ? 'pedido-publico' : 'app'}>
      {esPedidoPublico ? (
        <RutaPedidoPublico />
      ) : (
        <AuthProvider>
          <PermisosProvider>
            <NotificationsProvider>
              <App />
            </NotificationsProvider>
          </PermisosProvider>
        </AuthProvider>
      )}
    </ErrorBoundary>
  </StrictMode>
)
