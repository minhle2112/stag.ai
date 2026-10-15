// A video Stag Clip works on ("source"): an online video (yt-dlp) or a file on this computer.
// fetchSource reads its metadata and picks a transcript, in this order:
//   1. creator subtitles  2. auto subtitles (json3)  3. subtitles inside the file (ffprobe)  4. a sidecar .srt / .vtt
//   5. a .srt / .vtt the user picks (pickTranscript).
// v1 never runs speech recognition: no transcript → source.status = 'no_transcript'. Seam for later: transcribe() below.
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { parseTranscript } from './transcript.mjs'
import { getSource, hash, listSources, readJson, saveSource, SOURCE_ID_RE, sourceDir, writeJson } from './store.mjs'
import { run } from './tools.mjs'

const VIDEO_EXT = /\.(mp4|mkv|mov|webm|m4v|avi|flv|ts|mts|wmv|mpg|mpeg)$/i
const SUB_EXT = ['.srt', '.vtt']
/** yt-dlp's format URLs expire; info older than this is fetched again before cutting. */
export const INFO_FRESH_MS = 3 * 3600_000

export const isUrl = (s) => /^https?:\/\//i.test(String(s ?? '').trim())

/** "YouTube" / "Twitch" / "Kick" / host name, for tooltips. */
export function platformOf(url, extractor) {
  const h = (() => {
    try {
      return new URL(url).hostname.replace(/^www\.|^m\./, '')
    } catch {
      return ''
    }
  })()
  if (/youtube\.com$|youtu\.be$/.test(h) || /^youtube/i.test(extractor ?? '')) return 'YouTube'
  if (/twitch\.tv$/.test(h) || /^twitch/i.test(extractor ?? '')) return 'Twitch'
  if (/kick\.com$/.test(h) || /^kick/i.test(extractor ?? '')) return 'Kick'
  return h || extractor || 'Web'
}

/** Source id from a URL's extractor + video id, or from a file's path + size + mtime. */
export function onlineId(info) {
  const ex = String(info.extractor_key ?? info.extractor ?? 'web').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const vid = String(info.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const id = `${ex.slice(0, 12) || 'web'}-${vid || hash(info.webpage_url ?? '')}`
  // Video ids are case-sensitive (YouTube): add a short hash so two ids differing only by case stay apart.
  return /[A-Z]/.test(String(info.id ?? '')) ? `${id}-${hash(String(info.id), 4)}` : id
}
export const fileId = (path, st) => `file-${hash(`${path.toLowerCase()}|${st.size}|${Math.floor(st.mtimeMs)}`)}`

/** Turn what the agent / user gave (URL, path, or a source id) into { kind, url?, path?, id? }. */
export function parseInput(input, projectPath) {
  const s = String(input ?? '').trim().replace(/^"|"$/g, '')
  if (!s) throw new Error('Give a video URL, a file path, or a source id from clip_fetch.')
  if (isUrl(s)) return { kind: 'online', url: s }
  if (SOURCE_ID_RE.test(s) && !VIDEO_EXT.test(s)) return { kind: 'id', id: s }
  return { kind: 'file', path: isAbsolute(s) ? s : resolve(projectPath, s) }
}

/** Id of the placeholder record for a link that failed before yt-dlp told us its real id. */
export const placeholderId = (url) => `link-${hash(url)}`

/** Load a known source by id, URL or path (no network). null = never fetched. */
export async function findSource(ws, input, projectPath) {
  const p = parseInput(input, projectPath)
  if (p.kind === 'id') return getSource(ws, p.id)
  if (p.kind === 'file') {
    const st = await fs.stat(p.path).catch(() => null)
    return st ? getSource(ws, fileId(p.path, st)) : null
  }
  // URL: we only know its id after asking yt-dlp, so look through cached sources for the same URL.
  return (await listSources(ws)).find((x) => x.url === p.url || x.webpageUrl === p.url) ?? null
}

/**
 * Fetch (or refresh) a source and make sure it has a transcript when one exists.
 * tools = { 'yt-dlp': path, ffmpeg: path, ffprobe: path }; prefs = { langs: ['vi', 'en'] }.
 * Returns the saved source record.
 */
export async function fetchSource(ws, input, projectPath, tools, { lang, langs, cookies, signal, onStep } = {}) {
  const p = parseInput(input, projectPath)
  if (p.kind === 'id') {
    const known = await getSource(ws, p.id)
    if (!known) throw new Error(`No source "${p.id}". Call clip_fetch with the video URL or file path first.`)
    return fetchSource(ws, known.url ?? known.path, projectPath, tools, { lang, langs, cookies, signal, onStep })
  }
  return p.kind === 'online' ? fetchOnline(ws, p.url, tools, { lang, langs, cookies, signal, onStep }) : fetchFile(ws, p.path, tools, { lang, signal, onStep })
}

// ---- online (yt-dlp) ----

/** Map yt-dlp's error text to a reason the page can show (members-only / private / network / unavailable / other). */
export function errorReason(text) {
  const s = String(text ?? '')
  if (/members[- ]only|join this channel|Sign in to confirm your age|age[- ]restricted|subscriber|login required|cookies/i.test(s)) return 'login'
  if (/private video|This video is private/i.test(s)) return 'login'
  if (/unable to download webpage|timed out|getaddrinfo|ECONN|network|HTTP Error 5\d\d|Temporary failure|Connection reset/i.test(s)) return 'network'
  if (/not available|unavailable|removed|does not exist|404/i.test(s)) return 'unavailable'
  if (/Unsupported URL/i.test(s)) return 'unsupported'
  return 'other'
}

/** Download a cover image into the source's cache folder → path relative to the workspace. */
async function saveThumb(ws, id, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`thumbnail ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 5 * 1024 * 1024) throw new Error('thumbnail too large')
  const ext = /png/.test(res.headers.get('content-type') ?? '') ? 'png' : /webp/.test(res.headers.get('content-type') ?? '') ? 'webp' : 'jpg'
  await fs.writeFile(join(sourceDir(ws, id), `cover.${ext}`), buf)
  return `.stag/clip/${id}/cover.${ext}`
}

async function fileThumb(ws, id, path, ffmpeg, at) {
  await fs.mkdir(sourceDir(ws, id), { recursive: true })
  await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(at), '-i', path, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', join(sourceDir(ws, id), 'cover.jpg')], { timeoutMs: 60_000 })
  return `.stag/clip/${id}/cover.jpg`
}

async function fetchOnline(ws, url, tools, { lang, langs, cookies, signal, onStep }) {
  if (!tools['yt-dlp']) throw toolMissing('yt-dlp')
  onStep?.('info')
  const args = ['-J', '--skip-download', '--no-playlist', '--no-warnings', ...(cookies ? ['--cookies', cookies] : []), url]
  let info
  try {
    info = JSON.parse((await run(tools['yt-dlp'], args, { signal, timeoutMs: 3 * 60_000 })).stdout)
  } catch (e) {
    if (e.stopped) throw e
    throw Object.assign(new Error(String(e.message).replace(/^ERROR:\s*/gm, '')), { reason: errorReason(e.stderr ?? e.message) })
  }
  if (info._type === 'playlist') throw Object.assign(new Error('This link is a playlist or channel. Give the URL of one video.'), { reason: 'unsupported' })
  const id = onlineId(info)
  const dir = sourceDir(ws, id)
  // Keep yt-dlp's info (for subtitles via --load-info-json) without the huge format list's HTTP headers.
  await writeJson(join(dir, 'info.json'), info)
  const old = (await getSource(ws, id)) ?? {}
  const subs = subtitleList(info)
  const src = {
    ...old,
    id,
    kind: 'online',
    platform: platformOf(url, info.extractor_key),
    url,
    webpageUrl: info.webpage_url ?? url,
    title: info.title ?? info.fulltitle ?? id,
    channel: info.channel ?? info.uploader ?? null,
    duration: info.duration ?? null,
    language: info.language ?? origLang(info) ?? null,
    thumbnail: info.thumbnail ?? null,
    live: info.is_live ? true : undefined,
    chapters: (info.chapters ?? []).map((c) => ({ start: c.start_time, end: c.end_time, title: c.title })),
    hasHeatmap: Array.isArray(info.heatmap) && info.heatmap.length > 0,
    hasChat: !!info.subtitles?.live_chat || !!info.subtitles?.rechat,
    subtitles: subs,
    infoAt: new Date().toISOString(),
    createdAt: old.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: undefined
  }
  if (Array.isArray(info.heatmap)) await writeJson(join(dir, 'heatmap.json'), info.heatmap.map((h) => ({ start: h.start_time, end: h.end_time, value: h.value })))
  // Cover image saved next to the cache (the page cannot load images from the Internet).
  if (!old.thumb && info.thumbnail) src.thumb = await saveThumb(ws, id, info.thumbnail).catch(() => undefined)
  if (info.is_live) {
    src.status = 'error'
    src.error = { reason: 'live', message: 'This is a live stream. Wait until it has ended and the VOD is available.' }
    await saveSource(ws, src)
    return src
  }
  onStep?.('transcript')
  const pick = chooseSubtitle(subs, lang ?? src.language, langs)
  if (!pick) {
    src.status = 'no_transcript'
    src.transcript = null
    await saveSource(ws, src)
    return src
  }
  await ensureOnlineTranscript(ws, src, pick, tools, { cookies, signal })
  return src
}

/** Original language of auto captions ("vi-orig" → "vi"). */
function origLang(info) {
  const k = Object.keys(info.automatic_captions ?? {}).find((x) => x.endsWith('-orig'))
  return k ? k.replace(/-orig$/, '') : null
}

/** [{ lang, key, name, kind: 'creator' | 'auto', formats }] — auto captions only in the original language (+ ones we may want). */
export function subtitleList(info) {
  const out = []
  for (const [key, fmts] of Object.entries(info.subtitles ?? {})) {
    if (key === 'live_chat' || key === 'rechat' || !Array.isArray(fmts)) continue
    out.push({ lang: key.replace(/-orig$/, ''), key, name: fmts[0]?.name ?? key, kind: 'creator', formats: fmts.map((f) => f.ext) })
  }
  const auto = info.automatic_captions ?? {}
  const orig = Object.keys(auto).find((k) => k.endsWith('-orig'))
  const keys = orig ? [orig] : Object.keys(auto).filter((k) => k === info.language)
  for (const key of keys) out.push({ lang: key.replace(/-orig$/, ''), key, name: auto[key][0]?.name ?? key, kind: 'auto', formats: auto[key].map((f) => f.ext) })
  return out
}

/**
 * Creator subtitles in the wanted language → auto in the wanted language → the same for each preferred language
 * (Settings → "Ngôn ngữ phụ đề") → creator in any language → auto.
 */
export function chooseSubtitle(subs, lang, prefs = []) {
  const base = (l) => String(l ?? '').toLowerCase().split(/[-_]/)[0]
  const by = (kind, want) => subs.find((s) => s.kind === kind && (!want || base(s.lang) === want))
  for (const l of [lang, ...prefs].map(base).filter(Boolean)) {
    const hit = by('creator', l) ?? by('auto', l)
    if (hit) return hit
  }
  return by('creator') || by('auto') || null
}

async function ensureOnlineTranscript(ws, src, pick, tools, { cookies, signal }) {
  const dir = sourceDir(ws, src.id)
  const file = join(dir, `transcript.${pick.lang}.json`)
  const cached = await readJson(file)
  if (cached?.key === pick.key && Array.isArray(cached.sentences) && cached.sentences.length) {
    src.transcript = { lang: pick.lang, kind: pick.kind, sentences: cached.sentences.length }
    src.status = 'ready'
    await saveSource(ws, src)
    return
  }
  // Auto captions: json3 (word timings, no repeated lines); VTT only when json3 is not offered.
  const fmt = pick.formats.includes('json3') ? 'json3' : pick.formats.includes('srt') ? 'srt' : 'vtt'
  const tmp = join(dir, 'subs')
  await fs.rm(tmp, { recursive: true, force: true })
  await fs.mkdir(tmp, { recursive: true })
  const args = [
    '--load-info-json',
    join(dir, 'info.json'),
    '--skip-download',
    pick.kind === 'auto' ? '--write-auto-subs' : '--write-subs',
    '--sub-langs',
    pick.key,
    '--sub-format',
    fmt,
    '--no-warnings',
    ...(cookies ? ['--cookies', cookies] : []),
    '-o',
    join(tmp, 'sub.%(ext)s')
  ]
  try {
    await run(tools['yt-dlp'], args, { signal, timeoutMs: 3 * 60_000 })
  } catch (e) {
    if (e.stopped) throw e
    throw Object.assign(new Error(String(e.message).replace(/^ERROR:\s*/gm, '')), { reason: errorReason(e.stderr ?? e.message) })
  }
  const got = (await fs.readdir(tmp)).find((f) => f.startsWith('sub.'))
  if (!got) throw Object.assign(new Error('yt-dlp did not write the subtitle file.'), { reason: 'other' })
  const sentences = parseTranscript(await fs.readFile(join(tmp, got), 'utf8'), extname(got))
  await fs.rm(tmp, { recursive: true, force: true })
  await writeJson(file, { key: pick.key, kind: pick.kind, lang: pick.lang, sentences })
  src.transcript = sentences.length ? { lang: pick.lang, kind: pick.kind, sentences: sentences.length } : null
  src.status = sentences.length ? 'ready' : 'no_transcript'
  await saveSource(ws, src)
}

// ---- file on this computer ----

async function fetchFile(ws, path, tools, { lang, signal, onStep }) {
  const st = await fs.stat(path).catch(() => null)
  if (!st?.isFile()) throw Object.assign(new Error(`File not found: ${path}`), { reason: 'unavailable' })
  if (!tools.ffprobe) throw toolMissing('ffprobe')
  onStep?.('info')
  const id = fileId(path, st)
  const probe = JSON.parse((await run(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { signal, timeoutMs: 60_000 })).stdout)
  const streams = probe.streams ?? []
  const old = (await getSource(ws, id)) ?? {}
  const embedded = streams
    .filter((s) => s.codec_type === 'subtitle' && /subrip|ass|ssa|webvtt|mov_text|text/i.test(s.codec_name ?? ''))
    .map((s, i) => ({ lang: s.tags?.language ?? 'und', key: `embedded:${i}`, name: s.tags?.title ?? s.tags?.language ?? `#${i + 1}`, kind: 'embedded', index: i }))
  const sidecars = []
  const stem = path.slice(0, path.length - extname(path).length)
  const siblings = await fs.readdir(dirname(path)).catch(() => [])
  for (const f of siblings) {
    const full = join(dirname(path), f)
    const ext = extname(f).toLowerCase()
    if (!SUB_EXT.includes(ext) || !full.toLowerCase().startsWith(stem.toLowerCase())) continue
    // "talk.srt", "talk.en.srt", "talk.vi.vtt"
    const mid = full.slice(stem.length, full.length - ext.length).replace(/^\./, '')
    if (mid && !/^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/.test(mid)) continue
    sidecars.push({ lang: mid || 'und', key: `sidecar:${f}`, name: f, kind: 'sidecar', file: full })
  }
  const src = {
    ...old,
    id,
    kind: 'file',
    platform: 'file',
    path,
    title: old.title ?? basename(path, extname(path)),
    duration: Number(probe.format?.duration) || null,
    language: old.language ?? null,
    hasVideo: streams.some((s) => s.codec_type === 'video'),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    subtitles: [...embedded, ...sidecars, ...(old.subtitles ?? []).filter((s) => s.kind === 'picked')],
    thumb: old.thumb,
    createdAt: old.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: undefined
  }
  if (!src.thumb && src.hasVideo && tools.ffmpeg && src.duration) src.thumb = await fileThumb(ws, id, path, tools.ffmpeg, src.duration * 0.1).catch(() => undefined)
  onStep?.('transcript')
  const want = lang ?? src.transcript?.lang
  const pick =
    src.subtitles.find((s) => s.kind === 'picked') ??
    src.subtitles.find((s) => s.kind === 'embedded' && (!want || s.lang.startsWith(want))) ??
    src.subtitles.find((s) => s.kind === 'sidecar' && (!want || s.lang === 'und' || s.lang.startsWith(want))) ??
    src.subtitles[0]
  if (!pick) {
    src.status = 'no_transcript'
    src.transcript = null
    await saveSource(ws, src)
    return src
  }
  let text
  if (pick.kind === 'embedded') {
    if (!tools.ffmpeg) throw toolMissing('ffmpeg')
    text = (await run(tools.ffmpeg, ['-v', 'error', '-i', path, '-map', `0:s:${pick.index}`, '-f', 'srt', '-'], { signal, timeoutMs: 3 * 60_000 })).stdout
  } else text = await fs.readFile(pick.file, 'utf8')
  const sentences = parseTranscript(text, pick.kind === 'embedded' ? 'srt' : extname(pick.file))
  const lang2 = pick.lang === 'und' ? (src.language ?? 'und') : pick.lang
  await writeJson(join(sourceDir(ws, id), `transcript.${lang2}.json`), { key: pick.key, kind: pick.kind, lang: lang2, sentences })
  src.transcript = sentences.length ? { lang: lang2, kind: pick.kind, sentences: sentences.length } : null
  src.status = sentences.length ? 'ready' : 'no_transcript'
  await saveSource(ws, src)
  return src
}

/** The user picked a .srt / .vtt for a source without a transcript (scene 3). */
export async function pickTranscript(ws, id, file) {
  const src = await getSource(ws, id)
  if (!src) throw new Error(`No source "${id}"`)
  const ext = extname(file).toLowerCase()
  if (!SUB_EXT.includes(ext)) throw new Error('Pick a .srt or .vtt file.')
  const sentences = parseTranscript(await fs.readFile(file, 'utf8'), ext)
  if (!sentences.length) throw new Error('This file has no subtitle lines.')
  const lang = src.language ?? 'und'
  await writeJson(join(sourceDir(ws, id), `transcript.${lang}.json`), { key: `picked:${basename(file)}`, kind: 'picked', lang, sentences })
  src.subtitles = [...(src.subtitles ?? []).filter((s) => s.kind !== 'picked'), { lang, key: `picked:${basename(file)}`, name: basename(file), kind: 'picked', file }]
  src.transcript = { lang, kind: 'picked', sentences: sentences.length }
  src.status = 'ready'
  src.updatedAt = new Date().toISOString()
  await saveSource(ws, src)
  return src
}

/** Sentences of a source's current transcript (or the one in `lang`). */
export async function loadSentences(ws, src, lang) {
  const l = lang ?? src.transcript?.lang
  if (!l) return null
  const t = await readJson(join(sourceDir(ws, src.id), `transcript.${l}.json`))
  return Array.isArray(t?.sentences) ? t.sentences : null
}

/**
 * Seam for speech recognition (not in v1). A later version will run the app's Qwen3-ASR here and return sentences.
 * Kept so the transcript pipeline has one place to plug it in.
 */
export async function transcribe() {
  throw Object.assign(new Error('Speech recognition is not available yet. Add a .srt / .vtt file for this video.'), { reason: 'no_transcript' })
}

export function toolMissing(name) {
  return Object.assign(new Error(`${name} is not installed. Install it in Settings → Stag Clip → Tools.`), { reason: 'tool', tool: name })
}
