import { promises as fs } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import type { SourceKind, SourceSetup } from '@shared/inspect'
import type { Workspace } from '@shared/types'
import { t } from '@shared/i18n'
import { uiName } from '@shared/i18n/uiNames'
import { ensureIgnored } from './workspace'

/** File plugin của chế độ Soi chép vào `<dự án>/.stag/inspect/` (Vite / Next). */
const CODE_FILES: Record<'vite' | 'next', string[]> = {
  vite: ['stag-inspect-transform.mjs', 'stag-inspect-vite.mjs'],
  next: ['stag-inspect-transform.mjs', 'stag-inspect-next-loader.cjs']
}
const MU_PLUGIN = 'stag-inspect.php'

const exists = (p: string): Promise<boolean> =>
  fs.stat(p).then(
    () => true,
    () => false
  )

const rel = (ws: Workspace, full: string): string => relative(ws.path, full).split(sep).join('/')

async function firstFile(dirs: string[], names: string[]): Promise<string | null> {
  for (const d of dirs) for (const n of names) if (await exists(join(d, n))) return join(d, n)
  return null
}

/** Thư mục con một cấp (monorepo nhỏ: apps/web, frontend…), bỏ thư mục ẩn / node_modules. */
async function subdirs(root: string): Promise<string[]> {
  const out = [root]
  for (const name of await fs.readdir(root).catch(() => [] as string[])) {
    if (name.startsWith('.') || name === 'node_modules' || name.endsWith(' memory')) continue
    const full = join(root, name)
    if ((await fs.stat(full).catch(() => null))?.isDirectory()) out.push(full)
  }
  return out
}

/** Dự án đang dùng gì (Vite, Next.js, WordPress local) và đã cài phần tìm nguồn của chế độ Soi chưa. */
export async function detectSetup(ws: Workspace): Promise<SourceSetup> {
  const dirs = await subdirs(ws.path)
  const viteCfg = await firstFile(dirs, ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'])
  const nextCfg = await firstFile(dirs, ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'])
  const wpDirs = [...dirs, join(ws.path, 'app', 'public'), join(ws.path, 'public'), join(ws.path, 'wordpress'), join(ws.path, 'wp')]
  let wpContent: string | null = null
  for (const d of wpDirs) if (!wpContent && (await exists(join(d, 'wp-content', 'themes')))) wpContent = join(d, 'wp-content')
  const codeDir = join(ws.path, '.stag', 'inspect')
  return {
    vite: viteCfg ? { config: rel(ws, viteCfg), installed: await exists(join(codeDir, 'stag-inspect-vite.mjs')) } : null,
    next: nextCfg ? { config: rel(ws, nextCfg), installed: await exists(join(codeDir, 'stag-inspect-next-loader.cjs')) } : null,
    wordpress: wpContent ? { wpContent: rel(ws, wpContent), installed: await exists(join(wpContent, 'mu-plugins', MU_PLUGIN)) } : null
  }
}

/** Chép file vào dự án: Vite / Next → `.stag/inspect/`; WordPress → `wp-content/mu-plugins/stag-inspect.php`. */
export async function installSetup(ws: Workspace, kind: SourceKind, resources: string): Promise<string[]> {
  const setup = await detectSetup(ws)
  if (kind === 'wordpress') {
    if (!setup.wordpress) throw new Error(t('inspect.setup.noWpContent'))
    const target = join(ws.path, ...setup.wordpress.wpContent.split('/'), 'mu-plugins', MU_PLUGIN)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.copyFile(join(resources, MU_PLUGIN), target)
    return [rel(ws, target)]
  }
  const dir = join(ws.path, '.stag', 'inspect')
  await fs.mkdir(dir, { recursive: true })
  await ensureIgnored(ws.path, ['.stag/'], 'stag.ai kanban data').catch(() => {})
  const out: string[] = []
  for (const f of CODE_FILES[kind]) {
    await fs.copyFile(join(resources, f), join(dir, f))
    out.push(rel(ws, join(dir, f)))
  }
  return out
}

/** Gỡ mu-plugin WordPress. */
export async function removeWordpress(ws: Workspace): Promise<void> {
  const setup = await detectSetup(ws)
  if (!setup.wordpress) return
  await fs.rm(join(ws.path, ...setup.wordpress.wpContent.split('/'), 'mu-plugins', MU_PLUGIN), { force: true })
}

/** Đường dẫn import tương đối từ thư mục file cấu hình tới `.stag/inspect/<file>`. */
export function importPath(config: string, file: string): string {
  const from = posix.dirname(config)
  const r = posix.relative(from === '.' ? '' : from, `.stag/inspect/${file}`)
  return r.startsWith('.') ? r : `./${r}`
}

/** Lời nhờ agent gắn plugin vào file cấu hình (tiếng Anh, agent đọc). */
export function setupMessage(kind: 'vite' | 'next', config: string): string {
  if (kind === 'vite') {
    const p = importPath(config, 'stag-inspect-vite.mjs')
    return [
      `[stag.ai] Please enable stag.ai "${uiName.inspect()}" source mapping for the Vite dev server in ${config}.`,
      `stag.ai copied a small dev-only Vite plugin to ${p} (from the config's folder). It adds data-stag-src="file:line:col" to HTML elements while \`vite dev\` runs (apply: 'serve', enforce: 'pre'); builds are unchanged.`,
      `Add it as the FIRST plugin. .stag/ is git-ignored, so load it without breaking the config for people who do not have the file, e.g.:`,
      `  const stagInspect = await import('${p}').then((m) => m.default()).catch(() => null)`,
      `  plugins: [stagInspect, react(), ...].filter(Boolean)   // defineConfig(async () => ({ ... })) if the config is not already async`,
      `Then restart the dev server and tell me when done. Do not change anything else.`
    ].join('\n')
  }
  const p = importPath(config, 'stag-inspect-next-loader.cjs')
  return [
    `[stag.ai] Please enable stag.ai "${uiName.inspect()}" source mapping for the Next.js dev server in ${config}.`,
    `stag.ai copied a dev-only loader to ${p} (from the config's folder). It adds data-stag-src="file:line:col" to HTML elements in .jsx/.tsx/.js while \`next dev\` runs.`,
    `Webpack: in the next config add  webpack(config, { dev }) { if (dev) config.module.rules.push({ test: /\\.(jsx|tsx|js)$/, exclude: /node_modules/, enforce: 'pre', use: [path.resolve('${p}')] }); return config }  (keep any existing webpack function).`,
    `Turbopack (next dev --turbopack): turbopack: { rules: { '*.{jsx,tsx}': { loaders: [path.resolve('${p}')] } } }.`,
    `.stag/ is git-ignored: only add the rule when the file exists (fs.existsSync), so the config still works for others. Then restart the dev server and tell me when done. Do not change anything else.`
  ].join('\n')
}
