// Cutting clips. The clip keeps the source's own frame and audio: no subtitles burned in, no crop.
//   online → yt-dlp --download-sections "*s-e" (only that part is downloaded, never the whole video)
//   file   → ffmpeg -ss … -to …
// mode 'precise' re-encodes so the cut lands on the exact time; 'fast' copies streams (cut moves to a keyframe).
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fmtTime, snapCut } from './transcript.mjs'
import { getClips, newId, safeName, sourceDir, updateClips } from './store.mjs'
import { errorReason, loadSentences, toolMissing } from './source.mjs'
import { run } from './tools.mjs'

/** "18m42s" — sortable, readable part of a clip's file name. */
const stamp = (sec) => {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}h` : ''}${String(m).padStart(h ? 2 : 1, '0')}m${String(s % 60).padStart(2, '0')}s`
}

/** Folder for a source's clips inside the project (setting "Thư mục clip", default "clips"). */
export function clipFolder(projectPath, src, folderSetting = 'clips') {
  const base = /^[A-Za-z]:[\\/]|^[\\/]/.test(folderSetting) ? folderSetting : join(projectPath, folderSetting || 'clips')
  return join(base, safeName(src.title, 60))
}

/** Clips get numbers by start time, so the list matches the timeline. */
export const numbered = (clips) =>
  clips
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c, i) => ({ ...c, n: i + 1 }))

/**
 * Cut one clip and record it in clips.json. Returns the clip record.
 * opts: { start, end, title, reason, snap = true, mode, agent: { id, name }, signal, onProgress(pct) }
 */
export async function cutClip(ws, projectPath, src, tools, settings, opts) {
  if (!tools.ffmpeg) throw toolMissing('ffmpeg')
  if (src.kind === 'online' && !tools['yt-dlp']) throw toolMissing('yt-dlp')
  const duration = src.duration ?? Infinity
  let start = Math.max(0, Number(opts.start))
  let end = Math.min(duration, Number(opts.end))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Bad range ${opts.start}–${opts.end}: end must be after start, within the video (${fmtTime(duration)}).`)
  if (end - start > 30 * 60) throw new Error('A clip can be at most 30 minutes long.')
  if (opts.snap !== false) {
    const sentences = (await loadSentences(ws, src)) ?? []
    ;({ start, end } = snapCut(sentences, start, end, { duration }))
  }
  const dup = sameMoment(await getClips(ws, src.id), start, end)
  if (dup && !opts.allowDuplicate) return { ...dup, duplicate: true }
  const title = String(opts.title ?? '').trim().slice(0, 120) || `Clip ${fmtTime(start)}`
  const folder = clipFolder(projectPath, src, settings.clipFolder)
  await fs.mkdir(folder, { recursive: true })
  const id = opts.id ?? newId(5)
  const file = join(folder, `${stamp(start)}-${safeName(title, 50)}-${id}.mp4`)
  await retryOnce(() => cutFile(src, tools, { start, end, file, mode: opts.mode ?? settings.cutMode ?? 'precise', signal: opts.signal, onProgress: opts.onProgress, cookies: opts.cookies }), opts.signal)
  const thumb = join(sourceDir(ws, src.id), 'thumbs', `${id}.jpg`)
  await makeThumb(tools, file, thumb, (end - start) / 2).catch(() => {})
  const size = (await fs.stat(file)).size
  const clip = {
    id,
    sourceId: src.id,
    start,
    end,
    title,
    reason: String(opts.reason ?? '').trim().slice(0, 600),
    file,
    rel: relative(ws, file).split('\\').join('/'),
    thumb: relative(ws, thumb).split('\\').join('/'),
    size,
    state: 'pending',
    agentId: opts.agent?.id ?? null,
    agentName: opts.agent?.name ?? null,
    signals: opts.signals ?? undefined,
    createdAt: new Date().toISOString()
  }
  await updateClips(ws, src.id, (list) => [...list.filter((c) => c.id !== id), clip])
  return clip
}

/** Re-cut an existing clip with new times (±5 s on the page), replacing its file. No snapping: the user chose. */
export async function recutClip(ws, projectPath, src, tools, settings, clipId, { start, end, signal, onProgress, cookies }) {
  const clips = await getClips(ws, src.id)
  const old = clips.find((c) => c.id === clipId)
  if (!old) throw new Error(`No clip ${clipId}`)
  const s = Math.max(0, start)
  const e = Math.min(src.duration ?? Infinity, end)
  if (e - s < 1) throw new Error('A clip must be at least 1 second long.')
  const tmp = old.file.replace(/\.mp4$/i, `.recut-${newId(2)}.mp4`)
  await retryOnce(() => cutFile(src, tools, { start: s, end: e, file: tmp, mode: settings.cutMode ?? 'precise', signal, onProgress, cookies }), signal)
  // Same file name: a clip already on Sản phẩm gets a new version instead of a second artifact.
  const file = old.file
  await fs.rm(file, { force: true })
  await fs.rename(tmp, file)
  const thumb = join(sourceDir(ws, src.id), 'thumbs', `${old.id}.jpg`)
  await makeThumb(tools, file, thumb, (e - s) / 2).catch(() => {})
  const size = (await fs.stat(file)).size
  let out
  await updateClips(ws, src.id, (list) =>
    list.map((c) => (c.id === clipId ? (out = { ...c, start: s, end: e, file, rel: relative(ws, file).split('\\').join('/'), size, editedAt: new Date().toISOString() }) : c))
  )
  return out
}

/** YouTube downloads sometimes fail once (403 on a fragment, a dropped connection): try a second time after a pause. */
async function retryOnce(fn, signal) {
  try {
    return await fn()
  } catch (e) {
    if (e.stopped || signal?.aborted || !['network', 'other'].includes(e.reason ?? 'other')) throw e
    await new Promise((r) => setTimeout(r, 2000))
    return fn()
  }
}

/** A clip already cut that covers most of [start, end] (≥ 80 % overlap both ways), or null. */
export function sameMoment(clips, start, end) {
  return (
    clips.find((c) => {
      const o = Math.min(end, c.end) - Math.max(start, c.start)
      return o > 0 && o >= 0.8 * (end - start) && o >= 0.8 * (c.end - c.start)
    }) ?? null
  )
}

/** Run the cut itself into `file`. */
export async function cutFile(src, tools, { start, end, file, mode, signal, onProgress, cookies }) {
  const precise = mode !== 'fast'
  await fs.mkdir(dirname(file), { recursive: true })
  if (src.kind === 'online') {
    const out = file.replace(/\.mp4$/i, '')
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-f',
      'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
      '--download-sections',
      `*${start.toFixed(2)}-${end.toFixed(2)}`,
      ...(precise ? ['--force-keyframes-at-cuts'] : []),
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      tools.ffmpeg,
      '--no-part',
      '--no-mtime',
      ...(cookies ? ['--cookies', cookies] : []),
      '-o',
      `${out}.%(ext)s`,
      src.webpageUrl ?? src.url
    ]
    const len = end - start
    try {
      await run(tools['yt-dlp'], args, {
        signal,
        timeoutMs: 30 * 60_000,
        onLine: (l) => {
          // ffmpeg progress through yt-dlp: "time=00:00:12.34"; yt-dlp's own: "[download]  42.0%"
          const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(l)
          if (t && len > 0) onProgress?.(Math.min(99, Math.round(((+t[1] * 3600 + +t[2] * 60 + +t[3]) / len) * 100)))
          const d = /\[download\]\s+([\d.]+)%/.exec(l)
          if (d) onProgress?.(Math.min(99, Math.round(+d[1])))
        }
      })
    } catch (e) {
      if (e.stopped) throw e
      throw Object.assign(new Error(String(e.message).replace(/^ERROR:\s*/gm, '')), { reason: errorReason(e.stderr ?? e.message) })
    }
    // yt-dlp may keep another container when merging fails over; normalise the name.
    if (!(await fs.stat(file).catch(() => null))) {
      const dir = dirname(file)
      const stem = out.slice(dir.length + 1)
      const got = (await fs.readdir(dir)).find((f) => f.startsWith(stem + '.'))
      if (!got) throw Object.assign(new Error('yt-dlp finished but wrote no file.'), { reason: 'other' })
      if (got !== stem + '.mp4') await fs.rename(join(dir, got), file)
    }
    return
  }
  const len = end - start
  const args = precise
    ? ['-y', '-v', 'error', '-progress', 'pipe:1', '-ss', String(start), '-to', String(end), '-i', src.path, '-map', '0:v:0?', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-sn', file]
    : ['-y', '-v', 'error', '-progress', 'pipe:1', '-ss', String(start), '-to', String(end), '-i', src.path, '-map', '0:v:0?', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-sn', file]
  await run(tools.ffmpeg, args, {
    signal,
    timeoutMs: 30 * 60_000,
    onLine: (l) => {
      const m = /^out_time_ms=(\d+)/.exec(l)
      if (m && len > 0) onProgress?.(Math.min(99, Math.round((+m[1] / 1e6 / len) * 100)))
    }
  })
}

export async function makeThumb(tools, file, thumb, at) {
  await fs.mkdir(dirname(thumb), { recursive: true })
  await run(tools.ffmpeg, ['-y', '-v', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumb], { timeoutMs: 60_000 })
}
