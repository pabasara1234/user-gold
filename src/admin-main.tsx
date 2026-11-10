import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './portal.css'
import AdminPortal from './AdminPortal.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminPortal />
  </StrictMode>,
)