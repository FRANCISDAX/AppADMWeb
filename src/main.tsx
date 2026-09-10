import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/auth.tsx'
import { PermisosProvider } from './context/permisos.tsx'
import { NotificationsProvider } from './components/notifications.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <PermisosProvider>
        <NotificationsProvider>
          <App />
        </NotificationsProvider>
      </PermisosProvider>
    </AuthProvider>
  </StrictMode>,
)
