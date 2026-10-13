// stag.ai — chế độ Soi cho Next.js (webpack hoặc Turbopack), chỉ khi `next dev`: gắn data-stag-src="file:dòng:cột"
// vào thẻ HTML trong .jsx / .tsx / .js để stag.ai biết phần tử trên trang đến từ dòng nào.
//
// next.config.js (webpack):
//   webpack(config, { dev }) {
//     if (dev) config.module.rules.push({ test: /\.(jsx|tsx|js)$/, exclude: /node_modules/, enforce: 'pre',
//       use: [require.resolve('./.stag/inspect/stag-inspect-next-loader.cjs')] })
//     return config
//   }
// next.config.js (Turbopack, `next dev --turbopack`):
//   turbopack: { rules: { '*.{jsx,tsx}': { loaders: [require.resolve('./.stag/inspect/stag-inspect-next-loader.cjs')] } } }
const { join, relative, sep } = require('node:path')

module.exports = function stagInspectLoader(source) {
  const done = this.async()
  const file = this.resourcePath || ''
  if (/node_modules/.test(file)) return done(null, source)
  // Gốc dự án stag.ai = thư mục chứa `.stag/` (file này nằm ở `.stag/inspect/`); không phải thì gốc Next.
  const project = join(__dirname, '..', '..')
  const fromProject = relative(project, file)
  const rel = (fromProject.startsWith('..') ? relative(this.rootContext || process.cwd(), file) : fromProject).split(sep).join('/')
  import('./stag-inspect-transform.mjs')
    .then((m) => done(null, m.tagSource(source, rel) ?? source))
    .catch(() => done(null, source))
}
