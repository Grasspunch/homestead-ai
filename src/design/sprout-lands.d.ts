// The list of every file in the Sprout Lands packs, served by scripts/vite-sprout-lands.ts.
declare module 'virtual:sprout-lands' {
  export type PackId = 'sprites-premium' | 'sprites-basic' | 'ui-premium' | 'ui-basic'
  export type FileKind = 'png' | 'gif' | 'font' | 'aseprite' | 'text' | 'other'

  export interface PackInfo {
    id: PackId
    /** The folder the pack unzips to, e.g. "Sprout Lands - Sprites - premium pack". */
    title: string
    present: boolean
    count: number
  }

  export interface PackFile {
    pack: PackId
    packTitle: string
    /** Folder inside the pack, "" at its root. */
    dir: string
    name: string
    /** Served from public/: /assets/sprout-lands/<pack folder>/<dir>/<name>, URL-encoded. */
    url: string
    kind: FileKind
    w?: number
    h?: number
    bytes: number
    /** Names of the art/manifest.json frames cut from this file. */
    usedBy?: string[]
    /** Their source rectangles in this file: [x, y, w, h, frame name]. */
    rects?: [number, number, number, number, string][]
    /** Contents of small text files (the read_me license). */
    text?: string
  }

  const data: { missing: boolean; packs: PackInfo[]; files: PackFile[] }
  export default data
}
