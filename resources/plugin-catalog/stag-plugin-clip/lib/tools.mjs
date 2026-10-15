// Finding, running and installing the command-line tools Stag Clip needs: yt-dlp, ffmpeg, ffprobe.
// Search order: our own copy in the plugin's data folder → PATH → WinGet (Links + Packages).
import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

const WIN = process.platform === 'win32'
const exe = (name) => (WIN ? `${name}.exe` : name)
export const TOOL_NAMES = ['yt-dlp', 'ffmpeg', 'ffprobe']
/** yt-dlp older than this many days counts as outdated (YouTube changes break old versions). */
export const YTDLP_STALE_DAYS = 60

/** Folder for tools Stag Clip downloads itself (userData/plugins/clip-bin). */
export function binDir() {
  const data = process.env.STAG_PLUGIN_DATA
  return data ? join(dirname(data), 'clip-bin') : join(process.cwd(), '.clip-bin')
}

const isFile = async (p) => !!(await fs.stat(p).catch(() => null))?.isFile()

/** WinGet installs keep each package in its own folder; look two levels deep plus a /bin folder. */
async function wingetCandidates(name) {
  if (!WIN || !process.env.LOCALAPPDATA) return []
  const root = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet')
  const out = [join(root, 'Links', exe(name))]
  const pkgs = await fs.readdir(join(root, 'Packages')).catch(() => [])
  for (const p of pkgs) {
    if (!/yt-dlp|ffmpeg/i.test(p)) continue
    const dir = join(root, 'Packages', p)
    out.push(join(dir, exe(name)))
    for (const sub of await fs.readdir(dir).catch(() => [])) out.push(join(dir, sub, 'bin', exe(name)), join(dir, sub, exe(name)))
  }
  return out
}

/** Full path of a tool, or null. `override` = a path the user typed in Settings. */
export async function findTool(name, override) {
  if (override && (await isFile(override))) return override
  const cands = [join(binDir(), exe(name))]
  for (const d of (process.env.PATH ?? '').split(delimiter)) if (d) cands.push(join(d.replace(/^"|"$/g, ''), exe(name)))
  cands.push(...(await wingetCandidates(name)))
  for (const c of cands) if (await isFile(c)) return c
  return null
}

/**
 * Run a program and collect its output. Rejects with the last stderr lines on a non-zero exit.
 * `onLine` gets every stdout / stderr line as it arrives (progress); `signal` stops it.
 */
export function run(cmd, args, { cwd, onLine, signal, timeoutMs = 0, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    let outBytes = 0
    let err = ''
    let tail = ['', '']
    const feed = (i, chunk) => {
      if (!onLine) return
      const text = tail[i] + chunk
      const lines = text.split(/\r\n|\r|\n/)
      tail[i] = lines.pop() ?? ''
      for (const l of lines) if (l.trim()) onLine(l)
    }
    child.stdout.on('data', (d) => {
      outBytes += d.length
      if (outBytes <= maxBytes) out.push(d)
      feed(0, d.toString('utf8'))
    })
    child.stderr.on('data', (d) => {
      err = (err + d.toString('utf8')).slice(-8000)
      feed(1, d.toString('utf8'))
    })
    let timer = null
    if (timeoutMs) timer = setTimeout(() => child.kill(), timeoutMs)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const stdout = Buffer.concat(out).toString('utf8')
      if (signal?.aborted) return reject(Object.assign(new Error('Stopped'), { stopped: true }))
      if (code === 0) return resolve({ stdout, stderr: err })
      const last = err.split(/\r?\n/).filter((l) => l.trim()).slice(-4).join('\n')
      reject(Object.assign(new Error(last || `${cmd} exited with code ${code}`), { code, stderr: err }))
    })
  })
}

/** Version string of a tool ("2026.08.19" for yt-dlp, "8.1.2" / "N-125365-…" for ffmpeg), or null. */
export async function toolVersion(name, path) {
  try {
    if (name === 'yt-dlp') return (await run(path, ['--version'], { timeoutMs: 20_000 })).stdout.trim().split(/\s+/)[0] || null
    const { stdout } = await run(path, ['-version'], { timeoutMs: 20_000 })
    return /version\s+(\S+)/.exec(stdout)?.[1] ?? null
  } catch {
    return null
  }
}

/** yt-dlp versions are dates ("2026.08.19"): older than YTDLP_STALE_DAYS → outdated. */
export function ytdlpOutdated(version, now = new Date()) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version ?? '')
  if (!m) return false
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return (now.getTime() - at) / 86_400_000 > YTDLP_STALE_DAYS
}

/** State of every tool: { name: { path, version, outdated, own } }. `own` = in our download folder (can self-update). */
export async function toolStatus(overrides = {}) {
  const out = {}
  for (const name of TOOL_NAMES) {
    const path = await findTool(name, overrides[name])
    const version = path ? await toolVersion(name, path) : null
    out[name] = { path, version, outdated: name === 'yt-dlp' && ytdlpOutdated(version), own: !!path && path.startsWith(binDir()) }
  }
  return out
}

const DOWNLOADS = {
  'yt-dlp': WIN ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  ffmpeg: WIN ? 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' : null
}

async function download(url, file, onProgress) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  await fs.mkdir(dirname(file), { recursive: true })
  const ws = createWriteStream(file)
  for await (const chunk of res.body) {
    got += chunk.length
    if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r))
    if (total) onProgress?.(Math.round((got / total) * 100))
  }
  await new Promise((r, j) => ws.end((e) => (e ? j(e) : r())))
}

/**
 * Download a tool into binDir(). yt-dlp is a single file; ffmpeg comes as a zip (ffmpeg + ffprobe), unpacked with the
 * `tar` that ships with Windows 10+. Returns the new status of that tool.
 */
export async function installTool(name, onProgress) {
  const dir = binDir()
  await fs.mkdir(dir, { recursive: true })
  if (name === 'yt-dlp') {
    const tmp = join(dir, `${exe('yt-dlp')}.part`)
    await download(DOWNLOADS['yt-dlp'], tmp, onProgress)
    await fs.rename(tmp, join(dir, exe('yt-dlp')))
    if (!WIN) await fs.chmod(join(dir, 'yt-dlp'), 0o755)
    return
  }
  if (name === 'ffmpeg' || name === 'ffprobe') {
    if (!DOWNLOADS.ffmpeg) throw new Error('Install ffmpeg with your package manager (e.g. brew install ffmpeg / apt install ffmpeg).')
    const zip = join(dir, 'ffmpeg.zip')
    const unpack = join(dir, 'ffmpeg-unpack')
    await download(DOWNLOADS.ffmpeg, zip, onProgress)
    await fs.rm(unpack, { recursive: true, force: true })
    await fs.mkdir(unpack, { recursive: true })
    await run('tar', ['-xf', zip, '-C', unpack], { timeoutMs: 5 * 60_000 })
    for (const n of ['ffmpeg', 'ffprobe']) {
      const found = await findIn(unpack, exe(n))
      if (!found) throw new Error(`${n} not found in the downloaded archive`)
      await fs.copyFile(found, join(dir, exe(n)))
    }
    await fs.rm(unpack, { recursive: true, force: true })
    await fs.rm(zip, { force: true })
    return
  }
  throw new Error(`Unknown tool ${name}`)
}

/** Update yt-dlp: our own copy updates itself (-U); a copy from PATH / WinGet is replaced by a fresh copy of ours. */
export async function updateYtdlp(path, onProgress) {
  if (path && path.startsWith(binDir())) {
    await run(path, ['-U'], { timeoutMs: 5 * 60_000 })
    return
  }
  await installTool('yt-dlp', onProgress)
}

async function findIn(dir, file) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isFile() && e.name.toLowerCase() === file.toLowerCase()) return p
    if (e.isDirectory()) {
      const f = await findIn(p, file)
      if (f) return f
    }
  }
  return null
}
