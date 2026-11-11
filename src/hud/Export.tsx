// Download the finished run: the pull request as markdown, and the run report. Self-contained so it can move
// to wherever the pull request view ends up.
import type { Project } from '../run/store'
import type { RunState } from '../run/types'
import { download, prMarkdown, runReport, slug } from '../run/export'

export function ExportButtons({ p, s }: { p: Project; s: RunState }) {
  if (!s.done) return null
  return (
    <div className="row export-row">
      <button className="btn tan sm long" onClick={() => download(`${slug(p.name)}-pr.md`, prMarkdown(p, s))}>
        Download PR
      </button>
      <button className="btn tan sm long" onClick={() => download(`${slug(p.name)}-run-report.md`, runReport(p, s))}>
        Download run report
      </button>
    </div>
  )
}
