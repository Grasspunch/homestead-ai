import type { ReactNode } from 'react'

// Page furniture shared by every library page.
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="ds-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  )
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="ds-section">
      <h2>{title}</h2>
      {note && <p className="ds-note">{note}</p>}
      {children}
    </section>
  )
}

export function Rule({ children }: { children: ReactNode }) {
  return <li>{children}</li>
}

export function Rules({ children }: { children: ReactNode }) {
  return <ul className="ds-rules">{children}</ul>
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="ds-code">{children}</code>
}
