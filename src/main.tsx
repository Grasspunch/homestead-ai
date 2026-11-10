import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// For screenshots and debugging in development.
if (import.meta.env.DEV) import('./run/store').then(({ store }) => Object.assign(window, { store }))
