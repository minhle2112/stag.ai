// Transcript parsing for Stag Clip: YouTube json3 (word timings), SRT, WebVTT (incl. YouTube's rolling auto captions).
// Everything ends up as sentences [{ start, end, text }] (seconds), which the agent reads and cuts snap to.

const END_RE = /[.!?…。！？]["')\]»”’]*$/
/** A pause this long between two words ends a sentence even without punctuation (s). */
const PAUSE_S = 1.2
/** A sentence never runs longer than this (s): auto captions without punctuation would otherwise be one block. */
const MAX_SENTENCE_S = 25
/** One spoken word lasts at most this long (s): the last word of a caption line otherwise runs on through music. */
const MAX_WORD_S = 1.5

const clean = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** YouTube json3 → tokens [{ start, end, text }] (one per word when YouTube gives word offsets). */
export function json3Tokens(json) {
  const events = Array.isArray(json?.events) ? json.events : []
  const out = []
  for (const e of events) {
    if (!Array.isArray(e.segs) || typeof e.tStartMs !== 'number') continue
    const t0 = e.tStartMs / 1000
    const end = (e.tStartMs + (e.dDurationMs ?? 0)) / 1000
    const segs = e.segs.filter((s) => clean(s.utf8))
    segs.forEach((s, i) => {
      const start = t0 + (s.tOffsetMs ?? 0) / 1000
      const next = segs[i + 1]
      const stop = next ? t0 + (next.tOffsetMs ?? 0) / 1000 : end
      out.push({ start, end: Math.max(start, Math.min(stop, start + MAX_WORD_S)), text: clean(s.utf8) })
    })
  }
  out.sort((a, b) => a.start - b.start)
  // Rolling events overlap: a word's end is never past the next word's start.
  for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start, out[i + 1].start)
  return out
}

/** "00:01:02,500" / "01:02.500" / "1:02:03.5" → seconds. */
export function parseTime(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(s).trim())
  if (!m) return NaN
  return (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0)
}

/** SRT or WebVTT text → cues [{ start, end, text, words? }]. */
export function parseCues(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const cues = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)/.exec(lines[i])
    if (!m) continue
    const start = parseTime(m[1])
    const end = parseTime(m[2])
    const body = []
    // YouTube auto VTT has a " " line right after the times; an editor may have stripped it to "". Skip that one empty
    // line when real text follows (and that text is not the id of the next cue).
    if (lines[i + 1] === '' && lines[i + 2]?.trim() && !/-->/.test(lines[i + 2]) && !/-->/.test(lines[i + 3] ?? '')) i++
    // A cue ends at an empty line. YouTube auto VTT starts cues with a " " line, so whitespace-only lines belong to the cue.
    for (i++; i < lines.length && lines[i] !== '' && !/-->/.test(lines[i]); i++) body.push(lines[i])
    if (/-->/.test(lines[i] ?? '')) i--
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const cue = { start, end, text: clean(body.join(' ')) }
    // YouTube auto VTT: "<00:00:10.639><c> word</c>" inline word timings.
    const raw = body.join('\n')
    if (/<\d{1,2}:\d{2}[:.]/.test(raw)) {
      const words = []
      const re = /(?:<(\d[\d:.]+)>)?(?:<c[^>]*>)?([^<]+)(?:<\/c>)?/g
      for (const line of body) {
        if (!/<\d/.test(line)) continue
        let t = start
        let mm
        re.lastIndex = 0
        while ((mm = re.exec(line))) {
          if (mm[1]) t = parseTime(mm[1])
          const w = clean(mm[2])
          if (w) words.push({ start: t, text: w })
        }
      }
      if (words.length) cue.words = words
    }
    if (cue.text || cue.words) cues.push(cue)
  }
  return cues
}

/** Cues → tokens. Rolling captions (YouTube auto VTT: each cue repeats the previous line) are de-duplicated. */
export function cueTokens(cues) {
  const out = []
  if (cues.some((c) => c.words)) {
    for (const c of cues) for (const w of c.words ?? []) out.push({ start: w.start, end: Math.min(c.end, w.start + MAX_WORD_S), text: w.text })
    out.sort((a, b) => a.start - b.start)
    for (let i = 0; i < out.length - 1; i++) out[i].end = Math.max(out[i].start, Math.min(out[i].end, out[i + 1].start))
    return out
  }
  let prev = ''
  for (const c of cues) {
    let text = c.text
    // Rolling cue: starts with the previous cue's text → keep only the new part.
    if (prev && text.startsWith(prev)) text = text.slice(prev.length).trim()
    if (c.text) prev = c.text
    if (!text || (out.length && out[out.length - 1].text === text && c.start - out[out.length - 1].end < 1)) continue
    out.push({ start: c.start, end: Math.max(c.start, c.end), text })
  }
  return out
}

/** Split a multi-sentence token at sentence punctuation, sharing its time by character count. */
function splitToken(tok) {
  const parts = tok.text.match(/[^.!?…。！？]+[.!?…。！？]+["')\]»”’]*\s*|[^.!?…。！？]+$/g)
  if (!parts || parts.length < 2) return [tok]
  const total = tok.text.length
  const dur = tok.end - tok.start
  let at = tok.start
  return parts
    .map((p) => {
      const span = (dur * p.length) / total
      const t = { start: at, end: at + span, text: p.trim() }
      at += span
      return t
    })
    .filter((t) => t.text)
}

/** Tokens → sentences [{ start, end, text }], ended by punctuation, a pause, or the length cap. */
export function toSentences(tokens) {
  const flat = tokens.flatMap((t) => (t.text.split(' ').length > 3 ? splitToken(t) : [t]))
  const out = []
  let cur = null
  for (const t of flat) {
    if (cur && (t.start - cur.end >= PAUSE_S || t.end - cur.start > MAX_SENTENCE_S)) {
      out.push(cur)
      cur = null
    }
    if (!cur) cur = { start: t.start, end: t.end, text: t.text }
    else {
      cur.text += (/^[,.!?;:…]/.test(t.text) ? '' : ' ') + t.text
      cur.end = Math.max(cur.end, t.end)
    }
    if (END_RE.test(t.text)) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.map((s) => ({ start: round(s.start), end: round(Math.max(s.end, s.start + 0.3)), text: s.text.trim() })).filter((s) => s.text)
}

const round = (n) => Math.round(n * 100) / 100

/** Any supported subtitle file content → sentences. `ext` = json3 | srt | vtt (guessed when missing). */
export function parseTranscript(content, ext) {
  const kind = (ext ?? '').replace(/^\./, '').toLowerCase()
  if (kind === 'json3' || (!kind && /^\s*\{/.test(content))) return toSentences(json3Tokens(typeof content === 'string' ? JSON.parse(content) : content))
  return toSentences(cueTokens(parseCues(content)))
}

/** 3725.4 → "1:02:05"; 65 → "1:05". */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0')
}

/** "1:02:05" / "62:05" / "3725" / 3725 → seconds (NaN when unreadable). */
export function readTime(v) {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (/^\d+(\.\d+)?$/.test(s)) return +s
  const parts = s.split(':').map(Number)
  if (parts.some((p) => !Number.isFinite(p)) || parts.length > 3) return NaN
  return parts.reduce((a, p) => a * 60 + p, 0)
}

/**
 * A page of the transcript for the agent: sentences between `from` and `to` (s), at most `maxChars` characters.
 * Returns { text, from, to, next } — next = where the following page starts (null at the end).
 */
export function transcriptPage(sentences, from = 0, to = Infinity, maxChars = 12_000) {
  const lines = []
  let used = 0
  let last = from
  let next = null
  for (const s of sentences) {
    if (s.end <= from || s.start >= to) continue
    const line = `[${fmtTime(s.start)}] ${s.text}`
    if (used + line.length + 1 > maxChars && lines.length) {
      next = s.start
      break
    }
    lines.push(line)
    used += line.length + 1
    last = s.end
  }
  return { text: lines.join('\n'), from, to: next ?? Math.min(to, last), next }
}

/**
 * Snap a cut to sentence boundaries: start → the start of the sentence it falls in (or the nearest sentence start within
 * `slack` s), end → the end of the sentence it falls in (or nearest end). Keeps the clip within [minLen, maxLen] when given.
 */
export function snapCut(sentences, start, end, { slack = 6, duration = Infinity } = {}) {
  let s = start
  let e = end
  if (sentences.length) {
    const inS = sentences.find((x) => x.start <= start && start < x.end)
    const nearS = nearest(sentences.map((x) => x.start), start)
    if (inS && start - inS.start <= slack) s = inS.start
    else if (nearS !== null && Math.abs(nearS - start) <= slack) s = nearS
    const inE = sentences.find((x) => x.start < end && end <= x.end)
    const nearE = nearest(sentences.map((x) => x.end), end)
    if (inE && inE.end - end <= slack) e = inE.end
    else if (nearE !== null && Math.abs(nearE - end) <= slack) e = nearE
  }
  // A little air around the words so the first / last syllable is not clipped.
  s = Math.max(0, s - 0.25)
  e = Math.min(duration, e + 0.4)
  if (e <= s) e = Math.min(duration, s + Math.max(1, end - start))
  return { start: round(s), end: round(e) }
}

function nearest(list, v) {
  let best = null
  for (const x of list) if (best === null || Math.abs(x - v) < Math.abs(best - v)) best = x
  return best
}
