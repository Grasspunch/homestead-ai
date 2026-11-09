import type { ComponentType } from 'react'
import { ArtPage } from './pages/Art'
import { ColorPage } from './pages/Color'
import { ComponentsPage } from './pages/Components'
import { GlyphsPage } from './pages/Glyphs'
import { LogoPage } from './pages/Logo'
import { MotionPage } from './pages/Motion'
import { OverviewPage } from './pages/Overview'
import { ShapePage } from './pages/Shape'
import { TypePage } from './pages/Type'
import { WorkflowPage } from './pages/Workflow'

export type Route = { path: string; title: string; group: string; Page: ComponentType<{ arg?: string }> }

// The sidebar reads this list in order. Art pages take the pack as their argument (#/art/sprites-premium).
export const ROUTES: Route[] = [
  { path: '', title: 'Overview', group: '', Page: OverviewPage },
  { path: 'logo', title: 'Logo and icons', group: 'Foundations', Page: LogoPage },
  { path: 'color', title: 'Color', group: 'Foundations', Page: ColorPage },
  { path: 'type', title: 'Type', group: 'Foundations', Page: TypePage },
  { path: 'shape', title: 'Space and shape', group: 'Foundations', Page: ShapePage },
  { path: 'motion', title: 'Motion', group: 'Foundations', Page: MotionPage },
  { path: 'components', title: 'Controls', group: 'Components', Page: ComponentsPage },
  { path: 'glyphs', title: 'Field glyphs', group: 'Components', Page: GlyphsPage },
  { path: 'art/sprites-premium', title: 'Sprites, premium', group: 'Art', Page: ArtPage },
  { path: 'art/sprites-basic', title: 'Sprites, basic', group: 'Art', Page: ArtPage },
  { path: 'art/ui-premium', title: 'UI, premium', group: 'Art', Page: ArtPage },
  { path: 'art/ui-basic', title: 'UI, basic', group: 'Art', Page: ArtPage },
  { path: 'art/used', title: 'Used by the app', group: 'Art', Page: ArtPage },
  { path: 'workflow', title: 'How art gets in', group: 'Workflow', Page: WorkflowPage },
]
