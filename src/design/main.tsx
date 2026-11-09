import '../fonts'
import '../ds/tokens.css'
import '../ds/ds.css'
import './design.css'
import './pages.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DesignApp } from './DesignApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesignApp />
  </StrictMode>,
)
