// Where Stag Clip keeps things. Per workspace:
//   <workspace>/.stag/clip/<sourceId>/source.json   — what we know about the video (no expiring URLs)
//   <workspace>/.stag/clip/<sourceId>/info.json     — yt-dlp's full info (reused for subtitles while fresh)
//   <workspace>/.stag/clip/<sourceId>/transcript.<lang>.json — sentences
//   <workspace>/.stag/clip/<sourceId>/clips.json    — the clips cut from it
//   <workspace>/.stag/clip/<sourceId>/thumbs/<clipId>.jpg
// Clips themselves: <project>/clips/<video folder>/<clip file>.mp4
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export const cacheRoot = (workspacePath) => join(workspacePath, '.stag', 'clip')
export const sourceDir = (workspacePath, id) => join(cacheRoot(workspacePath), id)

/** Source ids are folder names: [a-z0-9-] only. */
export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/

export const newId = (n = 6) => randomBytes(n).toString('hex')
export const hash = (s, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n)

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''))
  } catch {
    return fallback
  }
}

/** Write JSON through a temp file + rename, so a crash never leaves half a file. */
export async function writeJson(file, value) {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${newId(3)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 1), 'utf8')
  await fs.rename(tmp, file)
}

/** One write at a time per file (clips.json is updated by the agent's tool and by the page at the same time). */
const chains = new Map()
export function update(file, fn, fallback) {
  const run = async () => {
    const cur = await readJson(file, fallback)
    const next = await fn(cur)
    await writeJson(file, next)
    return next
  }
  const p = (chains.get(file) ?? Promise.resolve()).then(run, run)
  chains.set(
    file,
    p.catch(() => {})
  )
  return p
}

export const getSource = (ws, id) => readJson(join(sourceDir(ws, id), 'source.json'))
export const saveSource = (ws, src) => writeJson(join(sourceDir(ws, src.id), 'source.json'), src)
export const getClips = async (ws, id) => (await readJson(join(sourceDir(ws, id), 'clips.json'), [])) ?? []
export const updateClips = (ws, id, fn) => update(join(sourceDir(ws, id), 'clips.json'), (c) => fn(Array.isArray(c) ? c : []), [])

/** Every source of the workspace, newest first. */
export async function listSources(ws) {
  const out = []
  for (const d of await fs.readdir(cacheRoot(ws), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || !SOURCE_ID_RE.test(d.name)) continue
    const src = await getSource(ws, d.name)
    if (src) out.push(src)
  }
  return out.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
}

/** Folder / file names: keeps letters of any language, drops what Windows forbids, max `n` chars. */
export function safeName(s, n = 60) {
  const v = String(s ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, n)
    .trim()
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(v) || !v ? 'video' : v
}

/** Total size of the transcript cache (Settings → "Transcript đã lưu"). */
export async function cacheSize(ws) {
  let total = 0
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(cacheRoot(ws))
  return total
}
