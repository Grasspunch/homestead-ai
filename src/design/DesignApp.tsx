import { useEffect, useState } from 'react'
import { ROUTES } from './routes'

function useHash() {
  const read = () => window.location.hash.replace(/^#\/?/, '')
  const [hash, setHash] = useState(read)
  useEffect(() => {
    const on = () => setHash(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function DesignApp() {
  const hash = useHash()
  const route = ROUTES.find((r) => r.path === hash) ?? ROUTES.find((r) => r.path !== '' && hash.startsWith(r.path)) ?? ROUTES[0]
  const arg = route.path.startsWith('art/') ? route.path.slice(4) : undefined
  const groups = [...new Set(ROUTES.map((r) => r.group))]

  useEffect(() => {
    document.title = route.path ? `${route.title} · Homestead design system` : 'Homestead design system'
    document.querySelector('.ds-main')?.scrollTo(0, 0)
  }, [route])

  return (
    <div className="ds">
      <nav className="ds-nav" aria-label="Design system">
        <a className="ds-brand" href="#/">
          <img src="/brand/barn-sticker.svg" alt="" width={28} height={28} />
          <span>Homestead</span>
        </a>
        {groups.map((g) => (
          <div className="ds-nav-group" key={g || 'top'}>
            {g && <h2>{g}</h2>}
            <ul>
              {ROUTES.filter((r) => r.group === g).map((r) => (
                <li key={r.path}>
                  <a href={`#/${r.path}`} aria-current={r === route ? 'page' : undefined}>
                    {r.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="ds-main">
        <div className="ds-page">
          <route.Page arg={arg} />
        </div>
      </main>
    </div>
  )
}
