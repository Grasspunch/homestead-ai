import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Kit } from './hud/Kit'
import { Intro } from './hud/Intro'

// The pitch's opening scene plays over Home only when the address has ?demo. Without it, nothing changes.
function Root() {
  const [intro, setIntro] = useState(() => new URLSearchParams(location.search).has('demo'))
  const endIntro = () => {
    setIntro(false)
    // Leave the address as the app's own, so a reload goes straight to Home.
    const url = new URL(location.href)
    url.searchParams.delete('demo')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  }
  return (
    <>
      <App />
      {intro && <Intro onDone={endIntro} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/kit' ? <Kit /> : <Root />}
  </StrictMode>,
)

// For screenshots and debugging in development.
if (import.meta.env.DEV) import('./run/store').then(({ store }) => Object.assign(window, { store }))
