import type { Plugin } from 'vite'

// Stub: replaced by the art-pipeline work. Serves `virtual:sprout-lands`, the list of every file in the packs.
export function sproutLands(): Plugin {
  const id = 'virtual:sprout-lands'
  return {
    name: 'homestead-sprout-lands',
    resolveId(source) {
      return source === id ? '\0' + id : null
    },
    load(resolved) {
      return resolved === '\0' + id ? 'export default { missing: true, files: [] }' : null
    },
  }
}
