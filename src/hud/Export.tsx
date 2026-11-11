// Download the finished run: the pull request as markdown, and the run report. Self-contained so it can move
// to wherever the pull request view ends up. A quiet group at the end of a button row: a meta label, two xs buttons.
import type { Project } from '../run/store'
import type { RunState } from '../run/types'
import { download, prMarkdown, runReport, slug } from '../run/export'

export function ExportButtons({ p, s }: { p: Project; s: RunState }) {
  if (!s.done) return null
  return (
    <span className="export-group" role="group" aria-label="Download">
      <span className="export-label">Download</span>
      <button className="btn tan xs long" aria-label="Download PR" onClick={() => download(`${slug(p.name)}-pr.md`, prMarkdown(p, s))}>
        PR
      </button>
      <button className="btn tan xs long" aria-label="Download run report" onClick={() => download(`${slug(p.name)}-run-report.md`, runReport(p, s))}>
        Run report
      </button>
    </span>
  )
}
