// stag.ai — chế độ Soi cho dự án Vite (React, Vue, Svelte, Preact, Solid, HTML tĩnh).
// Chỉ chạy khi `vite dev` (apply: 'serve'): gắn data-stag-src="file:dòng:cột" vào thẻ HTML trong mã nguồn để
// stag.ai biết phần tử trên trang đến từ dòng nào. Bản build (vite build) không đổi gì.
//
// Cách dùng (vite.config.ts / .js):
//   import stagInspect from './.stag/inspect/stag-inspect-vite.mjs'
//   export default defineConfig({ plugins: [stagInspect(), react()] })
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tagSource } from './stag-inspect-transform.mjs'

/** Gốc dự án stag.ai = thư mục chứa `.stag/` (file này nằm ở `.stag/inspect/`): đường dẫn tính từ đây để agent mở đúng. */
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

export default function stagInspect() {
  let root = process.cwd()
  const relOf = (file) => {
    const fromProject = relative(projectRoot, file)
    return (fromProject.startsWith('..') ? relative(root, file) : fromProject).split(sep).join('/')
  }
  return {
    name: 'stag-inspect',
    apply: 'serve',
    // Trước plugin của React / Vue / Svelte: gắn trên mã gốc, số dòng đúng file người viết.
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    transform(code, id) {
      if (id.includes('/node_modules/') || id.includes('\\node_modules\\') || id.startsWith('\0')) return null
      const file = id.split('?')[0]
      if (!/\.(jsx|tsx|js|vue|svelte)$/.test(file)) return null
      // Vue: chỉ file .vue gốc (không phải phần con ?vue&type=…).
      if (id.includes('?') && !/\?(v=|t=)/.test(id)) return null
      const rel = relOf(file)
      if (rel.startsWith('..')) return null
      const out = tagSource(code, rel)
      return out === null ? null : { code: out, map: null }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const rel = relOf(ctx.filename)
        return tagSource(html, rel) ?? html
      }
    }
  }
}
