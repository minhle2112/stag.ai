// Signals that hint where the good moments are. The transcript still decides; these only point the agent.
//   heatmap  — YouTube "most replayed" (yt-dlp `heatmap`, 100 points)
//   chat     — chat replay density + laughs (YouTube live_chat, Twitch rechat), per 30 s
//   loudness — audio loudness peaks per 5 s (files on this computer only: online videos are never downloaded whole)
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readJson, sourceDir, writeJson } from './store.mjs'
import { run } from './tools.mjs'
import { fmtTime } from './transcript.mjs'

export const CHAT_BUCKET_S = 30
export const LOUD_WINDOW_S = 5
const LAUGH_RE = /(ha){2,}|(he){3,}|(hi){3,}|\blo+l\b|lmao|rofl|kekw|omegalul|lul\b|😂|🤣|😆|😹|x[dD]\b|=\)\)+|:\)\)+|kk{2,}|\bwk(wk)+|ㅋㅋ|www+|jaja(ja)*|\bkaka/i

/** Percentile rank of `v` among `values` → "top N %" (1 = the highest). */
export function topPercent(values, v) {
  if (!values.length) return null
  const above = values.filter((x) => x > v).length
  return Math.max(1, Math.round(((above + 1) / values.length) * 100))
}

/** Heatmap [{ start, end, value }] → the highest windows, merged when adjacent: [{ start, end, value, top }]. */
export function heatPeaks(heat, n = 8) {
  if (!Array.isArray(heat) || !heat.length) return []
  const values = heat.map((h) => h.value)
  // Skip the very start: YouTube's heatmap always peaks on the first seconds (people opening the video).
  const body = heat.filter((h, i) => i > 1)
  const ranked = [...body].sort((a, b) => b.value - a.value)
  const picked = []
  for (const h of ranked) {
    if (picked.length >= n) break
    const near = picked.find((p) => h.start <= p.end + 1 && h.end >= p.start - 1)
    if (near) {
      near.start = Math.min(near.start, h.start)
      near.end = Math.max(near.end, h.end)
      near.value = Math.max(near.value, h.value)
    } else picked.push({ start: h.start, end: h.end, value: h.value })
  }
  return picked.map((p) => ({ ...p, top: topPercent(values, p.value) })).sort((a, b) => a.start - b.start)
}

/** Chat replay lines (yt-dlp live_chat JSON lines, or a rechat JSON) → [{ t (s), text }]. */
export function parseChat(text) {
  const out = []
  const visit = (o, offset) => {
    if (!o || typeof o !== 'object') return
    let t = offset
    if (o.videoOffsetTimeMsec !== undefined) t = Number(o.videoOffsetTimeMsec) / 1000
    else if (o.content_offset_seconds !== undefined) t = Number(o.content_offset_seconds)
    else if (o.contentOffsetSeconds !== undefined) t = Number(o.contentOffsetSeconds)
    // YouTube: message.runs[].text ; Twitch: message.body / message.fragments[].text
    const msg = o.liveChatTextMessageRenderer?.message ?? (o.message && typeof o.message === 'object' ? o.message : null)
    if (msg && Number.isFinite(t)) {
      const s = Array.isArray(msg.runs) ? msg.runs.map((r) => r.text ?? r.emoji?.shortcuts?.[0] ?? '').join('') : (msg.body ?? (msg.fragments ?? []).map((f) => f.text ?? '').join(''))
      out.push({ t, text: String(s ?? '') })
      return
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') visit(v, t)
  }
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return out
  if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('\n{'))) {
    try {
      visit(JSON.parse(trimmed), undefined)
      return out.sort((a, b) => a.t - b.t)
    } catch {
      /* fall through to JSON lines */
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      visit(JSON.parse(line), undefined)
    } catch {
      /* skip broken lines */
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Messages → per-bucket counts [{ start, count, laughs }]. */
export function chatBuckets(msgs, size = CHAT_BUCKET_S) {
  const map = new Map()
  for (const m of msgs) {
    const k = Math.floor(m.t / size) * size
    const b = map.get(k) ?? { start: k, count: 0, laughs: 0 }
    b.count++
    if (LAUGH_RE.test(m.text)) b.laughs++
    map.set(k, b)
  }
  return [...map.values()].sort((a, b) => a.start - b.start)
}

/** The busiest chat windows (by messages, laughs break ties). */
export function chatPeaks(buckets, n = 8) {
  const counts = buckets.map((b) => b.count)
  return [...buckets]
    .sort((a, b) => b.count - a.count || b.laughs - a.laughs)
    .slice(0, n)
    .map((b) => ({ start: b.start, end: b.start + CHAT_BUCKET_S, count: b.count, laughs: b.laughs, top: topPercent(counts, b.count) }))
    .sort((a, b) => a.start - b.start)
}

/** ffmpeg astats output → [{ start, rms (dBFS) }] per window. */
export function parseLoudness(text) {
  const out = []
  let t = null
  for (const line of String(text).split(/\r?\n/)) {
    const p = /pts_time:([\d.]+)/.exec(line)
    if (p) t = Number(p[1])
    const r = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(line)
    if (r && t !== null) out.push({ start: t, rms: r[1] === '-inf' ? -120 : Number(r[1]) })
  }
  return out
}

/** Windows clearly louder than the rest of the video (median + 6 dB), loudest first, merged. */
export function loudPeaks(windows, n = 8) {
  if (windows.length < 4) return []
  const sorted = windows.map((w) => w.rms).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const loud = windows.filter((w) => w.rms >= median + 6).sort((a, b) => b.rms - a.rms)
  const picked = []
  for (const w of loud) {
    if (picked.length >= n) break
    const near = picked.find((p) => w.start <= p.end + LOUD_WINDOW_S && w.start + LOUD_WINDOW_S >= p.start - LOUD_WINDOW_S)
    if (near) {
      near.start = Math.min(near.start, w.start)
      near.end = Math.max(near.end, w.start + LOUD_WINDOW_S)
    } else picked.push({ start: w.start, end: w.start + LOUD_WINDOW_S, db: Math.round((w.rms - median) * 10) / 10 })
  }
  return picked.sort((a, b) => a.start - b.start)
}

/**
 * Compute (or load from cache) every signal a source has. Returns
 * { heat: [...peaks], chat: { total, peaks } | null, loud: [...peaks] | null, notes: [...] }.
 */
export async function computeSignals(ws, src, tools, { cookies, signal, onStep } = {}) {
  const dir = sourceDir(ws, src.id)
  const cached = await readJson(join(dir, 'signals.json'))
  if (cached?.version === 1) return cached
  const out = { version: 1, heat: [], chat: null, loud: null, notes: [] }
  const heat = await readJson(join(dir, 'heatmap.json'), null)
  out.heat = heatPeaks(heat ?? [])
  if (!heat?.length) out.notes.push(src.kind === 'online' ? 'No "most replayed" data for this video.' : 'Most replayed data only exists for YouTube videos.')

  if (src.kind === 'online' && src.hasChat && tools['yt-dlp']) {
    onStep?.('chat')
    try {
      const tmp = join(dir, 'chat')
      await fs.rm(tmp, { recursive: true, force: true })
      await fs.mkdir(tmp, { recursive: true })
      await run(
        tools['yt-dlp'],
        ['--load-info-json', join(dir, 'info.json'), '--skip-download', '--write-subs', '--sub-langs', 'live_chat,rechat', '--no-warnings', ...(cookies ? ['--cookies', cookies] : []), '-o', join(tmp, 'chat.%(ext)s')],
        { signal, timeoutMs: 15 * 60_000 }
      )
      const files = await fs.readdir(tmp)
      const msgs = []
      for (const f of files) msgs.push(...parseChat(await fs.readFile(join(tmp, f), 'utf8')))
      await fs.rm(tmp, { recursive: true, force: true })
      const buckets = chatBuckets(msgs)
      await writeJson(join(dir, 'chat.json'), buckets)
      out.chat = { total: msgs.length, laughs: buckets.reduce((a, b) => a + b.laughs, 0), peaks: chatPeaks(buckets) }
    } catch (e) {
      if (e.stopped) throw e
      out.notes.push(`Chat replay could not be read (${String(e.message).split('\n')[0].slice(0, 120)}).`)
    }
  } else if (src.kind === 'online') out.notes.push('No chat replay for this video.')

  if (src.kind === 'file' && src.hasAudio && tools.ffmpeg) {
    onStep?.('loudness')
    try {
      const n = 8000 * LOUD_WINDOW_S
      const { stdout } = await run(
        tools.ffmpeg,
        ['-v', 'error', '-i', src.path, '-vn', '-sn', '-af', `aresample=8000,asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-'],
        { signal, timeoutMs: 20 * 60_000 }
      )
      const windows = parseLoudness(stdout)
      await writeJson(join(dir, 'loudness.json'), windows)
      out.loud = loudPeaks(windows)
    } catch (e) {
      if (e.stopped) throw e
      out.notes.push(`Loudness could not be measured (${String(e.message).split('\n')[0].slice(0, 120)}).`)
    }
  } else if (src.kind === 'online') out.notes.push('Loudness is only measured for files on this computer (online videos are never downloaded whole).')

  await writeJson(join(dir, 'signals.json'), out)
  return out
}

/** Text for the agent. */
export function signalsText(src, s) {
  const lines = [`Signals for ${src.id} (hints only: the transcript decides what is a good clip):`]
  const span = (p) => `${fmtTime(p.start)}–${fmtTime(p.end)}`
  if (s.heat.length) lines.push(`Most replayed: ${s.heat.map((p) => `${span(p)} (top ${p.top}%)`).join(', ')}`)
  if (s.chat?.peaks.length) lines.push(`Busiest chat (${s.chat.total} messages): ${s.chat.peaks.map((p) => `${span(p)} (${p.count} msgs${p.laughs ? `, ${p.laughs} laughs` : ''})`).join(', ')}`)
  if (s.loud?.length) lines.push(`Loudest moments: ${s.loud.map((p) => `${span(p)} (+${p.db} dB)`).join(', ')}`)
  if (lines.length === 1) lines.push('No signals for this video.')
  for (const n of s.notes) lines.push(`Note: ${n}`)
  return lines.join('\n')
}

/** Signals that fall inside one clip, for its card: { top?, laughs?, loud? }. */
export async function clipSignals(ws, srcId, clip) {
  const dir = sourceDir(ws, srcId)
  const [heat, chat, loud] = await Promise.all([readJson(join(dir, 'heatmap.json'), null), readJson(join(dir, 'chat.json'), null), readJson(join(dir, 'loudness.json'), null)])
  const out = {}
  const inside = (s, e) => e > clip.start && s < clip.end
  if (heat?.length) {
    const vals = heat.map((h) => h.value)
    const best = Math.max(-1, ...heat.filter((h, i) => i > 1 && inside(h.start, h.end)).map((h) => h.value))
    if (best >= 0) out.top = topPercent(vals, best)
  }
  if (chat?.length) {
    const laughs = chat.filter((b) => inside(b.start, b.start + CHAT_BUCKET_S)).reduce((a, b) => a + b.laughs, 0)
    if (laughs) out.laughs = laughs
  }
  if (loud?.length) {
    const sorted = loud.map((w) => w.rms).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const peak = Math.max(-200, ...loud.filter((w) => inside(w.start, w.start + LOUD_WINDOW_S)).map((w) => w.rms))
    if (peak >= median + 6) out.loud = Math.round((peak - median) * 10) / 10
  }
  return out
}
