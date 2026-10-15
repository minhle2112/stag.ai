// Worker of Stag Clip (see package.json → stagPlugin). Agents find the best moments in a long video from its existing
// transcript and cut them into clips; the user reviews them on the plugin's page.
// Text agents read is English; the page translates its own strings (ui/i18n.js).
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'
import { cutClip, numbered, recutClip } from './lib/cut.mjs'
import { fetchSource, findSource, isUrl, loadSentences, pickTranscript, placeholderId, platformOf } from './lib/source.mjs'
import { cacheSize, getClips, getSource, listSources, readJson, saveSource, sourceDir, updateClips } from './lib/store.mjs'
import { clipSignals, computeSignals, signalsText } from './lib/signals.mjs'
import { installTool, TOOL_NAMES, toolStatus, updateYtdlp } from './lib/tools.mjs'
import { fmtTime, readTime, transcriptPage } from './lib/transcript.mjs'

/** Clip length presets (s). 'auto' = the agent decides from the content. */
export const LENGTHS = { auto: null, '15-30': [15, 30], '30-60': [30, 60], '60-180': [60, 180], '180-600': [180, 600] }
const DEFAULT_SETTINGS = { length: 'auto', custom: [45, 90], count: 5, cutMode: 'precise', langs: [], clipFolder: 'clips', publishKept: true, paths: {}, firstRunDone: false }
const MAX_PARALLEL_CUTS = 2

const plugin = definePlugin({
  async setup(ctx) {
    const settings = async () => ({ ...DEFAULT_SETTINGS, ...((await ctx.state.get('settings')) ?? {}) })
    let toolCache = null
    const tools = async (fresh = false) => {
      if (!toolCache || fresh) toolCache = await toolStatus((await settings()).paths)
      return toolCache
    }
    const toolPaths = async () => Object.fromEntries(Object.entries(await tools()).map(([k, v]) => [k, v.path]))

    // ---- running jobs (fetch / cut / recut), shown on the page under "Đang chạy" ----
    const jobs = new Map()
    let cutsRunning = 0
    const waiting = []
    const emitJobs = (workspaceId) => ctx.streams.emit('jobs', { workspaceId, jobs: jobList(workspaceId) })
    const jobList = (workspaceId) =>
      [...jobs.values()].filter((j) => !workspaceId || j.workspaceId === workspaceId).map(({ ac, ...j }) => j)
    async function job(info, fn) {
      const id = Math.random().toString(36).slice(2, 10)
      const ac = new AbortController()
      const j = { id, ...info, pct: 0, step: info.step ?? null, startedAt: new Date().toISOString(), ac }
      jobs.set(id, j)
      emitJobs(j.workspaceId)
      let last = 0
      const progress = (pct, step) => {
        j.pct = pct
        if (step) j.step = step
        if (Date.now() - last > 400 || step) {
          last = Date.now()
          emitJobs(j.workspaceId)
        }
      }
      try {
        return await fn({ signal: ac.signal, progress })
      } finally {
        jobs.delete(id)
        emitJobs(j.workspaceId)
      }
    }
    /** Cuts are heavy (download + encode): at most MAX_PARALLEL_CUTS at a time, the rest wait their turn. */
    async function cutSlot(fn) {
      if (cutsRunning >= MAX_PARALLEL_CUTS) await new Promise((r) => waiting.push(r))
      cutsRunning++
      try {
        return await fn()
      } finally {
        cutsRunning--
        waiting.shift()?.()
      }
    }
    const changed = (workspaceId, sourceId) => ctx.streams.emit('sources', { workspaceId, sourceId })

    // ---- sign-in cookies (members-only / private videos) ----
    // Only for a source that said it needs sign-in: the Browser pane's cookies for its site go into a temp cookies.txt
    // for yt-dlp, deleted right after the run.
    const COOKIE_DOMAINS = { YouTube: ['youtube.com', 'google.com'], Twitch: ['twitch.tv'], Kick: ['kick.com'] }
    async function cookieJar(run, src) {
      if (!src || src.kind !== 'online' || !(src.needsLogin || src.error?.reason === 'login')) return null
      let domains = COOKIE_DOMAINS[src.platform]
      if (!domains) {
        try {
          domains = [new URL(src.webpageUrl ?? src.url).hostname.replace(/^www\./, '')]
        } catch {
          return null
        }
      }
      const lines = ['# Netscape HTTP Cookie File']
      for (const d of domains) {
        const r = await ctx.browser.cookies(run.workspaceId, d).catch(() => null)
        if (r?.count) lines.push(...r.text.split('\n').slice(1).filter(Boolean))
      }
      if (lines.length === 1) return null
      const dir = join(dirname(process.env.STAG_PLUGIN_DATA ?? process.cwd()), 'clip-tmp')
      await fs.mkdir(dir, { recursive: true })
      const path = join(dir, `cookies-${randomBytes(6).toString('hex')}.txt`)
      await fs.writeFile(path, lines.join('\n') + '\n', { mode: 0o600 })
      return { path, done: () => fs.rm(path, { force: true }).catch(() => {}) }
    }
    /** Run fn(cookiesPath | undefined) with the source's sign-in cookies when it needs them. */
    async function withCookies(run, src, fn) {
      const jar = await cookieJar(run, src)
      try {
        return await fn(jar?.path)
      } finally {
        await jar?.done()
      }
    }

    const wsOf = (run) => {
      if (!run?.workspacePath) throw new Error('Stag Clip works inside a workspace. Open one first.')
      return run.workspacePath
    }
    const projectOf = (run) => run.projectPath ?? run.workspacePath

    async function fetchFor(run, input, lang) {
      const ws = wsOf(run)
      const src0 = await findSource(ws, input, projectOf(run)).catch(() => null)
      return job({ kind: 'fetch', workspaceId: run.workspaceId, sourceId: src0?.id ?? null, title: src0?.title ?? String(input).slice(0, 120), agentName: run.agentName ?? null, step: 'info' }, async ({ signal, progress }) => {
        try {
          const jar = await cookieJar(run, src0)
          let src
          try {
            src = await fetchSource(ws, input, projectOf(run), await toolPaths(), { lang, langs: (await settings()).langs, cookies: jar?.path, signal, onStep: (s) => progress(s === 'info' ? 10 : 50, s) })
          } finally {
            await jar?.done()
          }
          // Signed in: later cuts / chat of this video use the cookies too.
          if (jar && !src.needsLogin) {
            src.needsLogin = true
            await saveSource(ws, src)
          }
          // Signals in the background (chat replay can take minutes); clip_signals picks up the same run.
          if (src.status === 'ready') void signalsFor(run, src).catch(() => {})
          // A link that failed before (placeholder record) now has its real id: drop the placeholder.
          if (src0 && src0.id !== src.id && src0.placeholder) await fs.rm(sourceDir(ws, src0.id), { recursive: true, force: true })
          changed(run.workspaceId, src.id)
          return src
        } catch (e) {
          // Remember the failure so the page can show "Không tải được" with the right action. A new link that failed
          // before yt-dlp gave its id gets a placeholder record.
          if (!e.stopped && (src0 || isUrl(input))) {
            const url = String(input).trim()
            const base = src0 ?? { id: placeholderId(url), kind: 'online', platform: platformOf(url), url, title: url, placeholder: true, createdAt: new Date().toISOString() }
            await saveSource(ws, {
              ...base,
              status: 'error',
              needsLogin: base.needsLogin || e.reason === 'login' || undefined,
              error: { reason: e.reason ?? 'other', message: String(e.message).slice(0, 500), tool: e.tool },
              updatedAt: new Date().toISOString()
            })
            changed(run.workspaceId, base.id)
          }
          throw e
        }
      })
    }

    const lengthLine = (s) => {
      const r = s.length === 'custom' ? s.custom : LENGTHS[s.length]
      return r ? `each clip ${fmtSpan(r[0])}–${fmtSpan(r[1])}` : 'clip length: your choice, whatever fits each moment'
    }
    const fmtSpan = (sec) => (sec >= 60 && sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`)

    // ---- agent tools ----

    ctx.tools.register('clip_fetch', async ({ source, lang }, run) => {
      const src = await fetchFor(run, source, lang)
      const s = await settings()
      const lines = [`Source ${src.id}: "${src.title}" (${src.platform === 'file' ? 'file on this computer' : src.platform}${src.duration ? `, ${fmtTime(src.duration)}` : ''}${src.channel ? `, ${src.channel}` : ''}).`]
      if (src.status === 'error') return { content: `${lines[0]} ${src.error?.message ?? 'It cannot be used.'}`, isError: true }
      if (src.status === 'no_transcript') {
        lines.push(
          'This video has no transcript (no subtitles online, none inside the file, no .srt / .vtt next to it). Stag Clip v1 only works from an existing transcript, so stop here and tell the user: they can add a .srt / .vtt file on the Stag Clip page.'
        )
        return { content: lines.join('\n'), isError: true }
      }
      const others = (src.subtitles ?? []).filter((x) => x.lang !== src.transcript.lang).map((x) => `${x.lang} (${x.kind})`)
      lines.push(
        `Transcript: ${src.transcript.lang} (${kindName(src.transcript.kind)}), ${src.transcript.sentences} sentences. Read all of it with clip_transcript(source: "${src.id}", from, to) page by page.`
      )
      if (others.length) lines.push(`Other transcript languages: ${others.slice(0, 12).join(', ')}.`)
      if (src.chapters?.length) lines.push(`Chapters: ${src.chapters.slice(0, 30).map((c) => `${fmtTime(c.start)} ${c.title}`).join(' · ')}`)
      if (src.hasHeatmap) lines.push('YouTube "most replayed" data exists for this video.')
      const existing = await getClips(wsOf(run), src.id)
      if (existing.length) lines.push(`${existing.length} clip(s) were already cut from it; see clip_list before cutting more.`)
      lines.push(`User's defaults: ${s.count} clips, ${lengthLine(s)} (the user's request in chat wins). Cut each with clip_cut. Titles and reasons in the user's language.`)
      return { content: lines.join('\n') }
    })

    ctx.tools.register('clip_transcript', async ({ source, from, to, lang }, run) => {
      const ws = wsOf(run)
      let src = await findSource(ws, source, projectOf(run))
      if (!src || (lang && lang !== src.transcript?.lang)) src = await fetchFor(run, source, lang)
      if (!src.transcript) return { content: `Source ${src.id} has no transcript. Call clip_fetch first and tell the user if it has none.`, isError: true }
      const sentences = (await loadSentences(ws, src, lang)) ?? []
      const f = from === undefined || from === '' ? 0 : readTime(from)
      const t = to === undefined || to === '' ? Infinity : readTime(to)
      if (!Number.isFinite(f) || Number.isNaN(t)) return { content: 'from / to must be seconds (e.g. 125) or h:mm:ss (e.g. 1:02:05).', isError: true }
      const page = transcriptPage(sentences, f, t)
      const head = `Transcript of ${src.id} (${src.transcript.lang}), ${fmtTime(page.from)}–${fmtTime(page.to)} of ${fmtTime(src.duration ?? page.to)}:`
      const tail = page.next !== null ? `\n— More: clip_transcript(source: "${src.id}", from: ${Math.floor(page.next)})` : '\n— End of transcript.'
      return { content: `${head}\n${page.text || '(no speech in this range)'}${tail}` }
    })

    ctx.tools.register('clip_cut', async ({ source, start, end, title, reason, snap }, run) => {
      const ws = wsOf(run)
      let src = await findSource(ws, source, projectOf(run))
      if (!src) src = await fetchFor(run, source)
      if (src.status === 'error') return { content: `Source ${src.id} cannot be used: ${src.error?.message ?? 'error'}`, isError: true }
      const s = readTime(start)
      const e = readTime(end)
      if (!Number.isFinite(s) || !Number.isFinite(e)) return { content: 'start / end must be seconds (e.g. 125.5) or h:mm:ss (e.g. 1:02:05).', isError: true }
      const st = await settings()
      const tp = await toolPaths()
      const clip = await cutSlot(() =>
        job({ kind: 'cut', workspaceId: run.workspaceId, sourceId: src.id, title: String(title ?? '').slice(0, 120), agentName: run.agentName ?? null, step: 'cut' }, ({ signal, progress }) =>
          withCookies(run, src, (cookies) =>
            cutClip(ws, projectOf(run), src, tp, st, { start: s, end: e, title, reason, snap: snap !== false, agent: { id: run.agentId, name: run.agentName }, cookies, signal, onProgress: progress })
          )
        )
      )
      changed(run.workspaceId, src.id)
      const all = numbered(await getClips(ws, src.id))
      const n = all.find((c) => c.id === clip.id)?.n
      if (clip.duplicate)
        return {
          content: `Not cut: clip ${n} (${fmtTime(clip.start)}–${fmtTime(clip.end)} "${clip.title}") already covers this moment. Pick another moment, or move on.`
        }
      return {
        content: `Cut clip ${n} of ${src.id}: ${fmtTime(clip.start)}–${fmtTime(clip.end)} (${fmtTime(clip.end - clip.start)}) "${clip.title}". File: ${clip.rel}. The user reviews it on the Stag Clip page (keep / drop); do not publish it yourself.`
      }
    })

    ctx.tools.register('clip_signals', async ({ source }, run) => {
      const ws = wsOf(run)
      let src = await findSource(ws, source, projectOf(run))
      if (!src) src = await fetchFor(run, source)
      if (src.status === 'error') return { content: `Source ${src.id} cannot be used: ${src.error?.message ?? 'error'}`, isError: true }
      const s = await signalsFor(run, src)
      changed(run.workspaceId, src.id)
      return { content: signalsText(src, s) }
    })

    /**
     * Signals of a source (cached in signals.json); runs as a job so the page shows the "Tìm tín hiệu" step. Started in
     * the background after every fetch; clip_signals waits for the same run instead of starting a second one.
     */
    const signalRuns = new Map()
    function signalsFor(run, src) {
      const key = `${run.workspacePath}|${src.id}`
      const busy = signalRuns.get(key)
      if (busy) return busy
      const ws = wsOf(run)
      const p = job({ kind: 'signals', workspaceId: run.workspaceId, sourceId: src.id, title: src.title, agentName: run.agentName ?? null, step: 'signals' }, ({ signal, progress }) =>
        withCookies(run, src, async (cookies) => computeSignals(ws, src, await toolPaths(), { cookies, signal, onStep: (s) => progress(s === 'chat' ? 30 : 60, s) }))
      ).finally(() => {
        signalRuns.delete(key)
        changed(run.workspaceId, src.id)
      })
      signalRuns.set(key, p)
      return p
    }

    ctx.tools.register('clip_list', async ({ source }, run) => {
      const ws = wsOf(run)
      const src = await findSource(ws, source, projectOf(run))
      if (!src) return { content: `No source "${source}" yet. Call clip_fetch first.`, isError: true }
      const clips = numbered(await getClips(ws, src.id))
      if (!clips.length) return { content: `No clips cut from ${src.id} yet.` }
      return {
        content: clips.map((c) => `${c.n}. ${fmtTime(c.start)}–${fmtTime(c.end)} "${c.title}" — ${c.state === 'kept' ? 'kept by the user' : c.state === 'dropped' ? 'dropped by the user' : 'waiting for the user'}`).join('\n')
      }
    })

    // ---- page: data ----

    ctx.data.register('overview', async (_p, run) => {
      const ws = wsOf(run)
      const sources = await listSources(ws)
      const out = []
      for (const src of sources) {
        const clips = await getClips(ws, src.id)
        out.push({ ...src, counts: countStates(clips) })
      }
      return { sources: out, jobs: jobList(run.workspaceId), settings: await settings() }
    })

    ctx.data.register('source', async ({ id }, run) => {
      const ws = wsOf(run)
      const src = await getSource(ws, String(id))
      if (!src) return null
      const [clips, sentences, heatmap] = await Promise.all([getClips(ws, src.id), loadSentences(ws, src), readJson(join(sourceDir(ws, src.id), 'heatmap.json'), null)])
      const withSignals = await Promise.all(numbered(clips).map(async (c) => ({ ...c, sig: await clipSignals(ws, src.id, c) })))
      return { source: src, clips: withSignals, sentences: sentences ?? [], heatmap }
    })

    ctx.data.register('settings', async (_p, run) => ({
      settings: await settings(),
      tools: await tools(true),
      cacheBytes: run?.workspacePath ? await cacheSize(run.workspacePath) : null
    }))

    // ---- page: actions ----

    ctx.actions.register('fetch', async ({ input }, run) => {
      const src = await fetchFor(run, String(input ?? ''))
      return { id: src.id, status: src.status }
    })

    ctx.actions.register('decide', async ({ sourceId, clipIds, state }, run) => {
      const ws = wsOf(run)
      if (!['kept', 'dropped', 'pending'].includes(state)) throw new Error('Bad state')
      const ids = new Set(Array.isArray(clipIds) ? clipIds.map(String) : [])
      const before = await getClips(ws, String(sourceId))
      await updateClips(ws, String(sourceId), (list) => list.map((c) => (ids.has(c.id) ? { ...c, state, decidedAt: new Date().toISOString() } : c)))
      changed(run.workspaceId, String(sourceId))
      // Kept → Sản phẩm (Settings → "Clip đã giữ → Sản phẩm"), under the task of the agent that cut it.
      const failed = []
      if (state === 'kept' && (await settings()).publishKept) {
        const src = await getSource(ws, String(sourceId))
        for (const c of before.filter((x) => ids.has(x.id) && !x.artifactId)) {
          const r = await publishClip(run, src, c)
          if (r.error) failed.push({ id: c.id, error: r.error })
        }
        changed(run.workspaceId, String(sourceId))
      }
      return { previous: before.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, state: c.state })), failed }
    })

    /** Publish one clip to Sản phẩm; remembers the artifact id on the clip. → { id } | { error } */
    async function publishClip(run, src, c) {
      if (!c.agentId) return { error: 'no agent cut this clip' }
      try {
        const r = await ctx.artifacts.publish(run.workspaceId, c.agentId, {
          file: c.rel,
          title: c.title,
          description: [c.reason, `${fmtTime(c.start)}–${fmtTime(c.end)} · ${src?.title ?? ''}`].filter(Boolean).join('\n')
        })
        await updateClips(wsOf(run), c.sourceId, (list) => list.map((x) => (x.id === c.id ? { ...x, artifactId: r.id } : x)))
        return r
      } catch (e) {
        return { error: String(e?.message ?? e).slice(0, 300) }
      }
    }

    ctx.actions.register('ask', async ({ sourceId, query, length, custom, count, agentId, locale }, run) => {
      const ws = wsOf(run)
      const src = await getSource(ws, String(sourceId))
      if (!src) throw new Error('Source not found')
      const s = { ...(await settings()), length: length in LENGTHS || length === 'custom' ? length : 'auto', custom: Array.isArray(custom) ? custom : [45, 90] }
      const n = Number.isInteger(count) && count > 0 && count <= 30 ? count : (await settings()).count
      const language = locale === 'en' ? 'English' : 'Vietnamese'
      const existing = (await getClips(ws, src.id)).length
      const what = String(query ?? '').trim().slice(0, 1000)
      const text = [
        `[Stag Clip] Find the ${n} best moments in this video and cut each one into a clip.`,
        `Video: ${src.webpageUrl ?? src.url ?? src.path} (source id ${src.id}${src.duration ? `, ${fmtTime(src.duration)}` : ''}).`,
        `What to look for: ${what ? `"${what}"` : 'the most interesting, funny or quotable moments'}.`,
        `${lengthLine(s).replace(/^./, (c) => c.toUpperCase())}.`,
        `Steps: clip_fetch → clip_signals (hints: most replayed, chat, loudness) → read the whole transcript with clip_transcript, page by page → clip_cut for each clip (title and a one-sentence reason in ${language}).${existing ? ' Call clip_list first: do not repeat clips already cut.' : ''}`,
        `The user reviews the clips on the Stag Clip page. When done, reply in ${language} with a short list.`
      ].join('\n')
      const r = await ctx.agents.ask(String(agentId), text)
      return { status: r?.status ?? 'sent' }
    })

    ctx.actions.register('nudge', async ({ sourceId, clipId, start, end }, run) => {
      const ws = wsOf(run)
      const src = await getSource(ws, String(sourceId))
      if (!src) throw new Error('Source not found')
      const clip = (await getClips(ws, src.id)).find((c) => c.id === clipId)
      if (!clip) throw new Error('Clip not found')
      const st = await settings()
      const tp = await toolPaths()
      const next = await cutSlot(() =>
        job({ kind: 'recut', workspaceId: run.workspaceId, sourceId: src.id, clipId, title: clip.title, agentName: null, step: 'cut' }, ({ signal, progress }) =>
          withCookies(run, src, (cookies) => recutClip(ws, null, src, tp, st, clipId, { start: Number(start), end: Number(end), cookies, signal, onProgress: progress }))
        )
      )
      // Already on Sản phẩm: the new cut becomes its next version.
      if (next?.artifactId && next.state === 'kept') await publishClip(run, src, next)
      changed(run.workspaceId, src.id)
      return next
    })

    ctx.actions.register('remove', async ({ sourceId }, run) => {
      const ws = wsOf(run)
      await fs.rm(sourceDir(ws, String(sourceId)), { recursive: true, force: true })
      changed(run.workspaceId, String(sourceId))
      return {}
    })

    ctx.actions.register('pickTranscript', async ({ sourceId, file }, run) => {
      const src = await pickTranscript(wsOf(run), String(sourceId), String(file))
      changed(run.workspaceId, src.id)
      return { status: src.status }
    })

    ctx.actions.register('stop', async ({ jobId }) => {
      jobs.get(String(jobId))?.ac.abort()
      return {}
    })

    ctx.actions.register('settings.set', async ({ patch }) => {
      const cur = await settings()
      const next = { ...cur, ...sanitizeSettings(patch ?? {}) }
      await ctx.state.set('settings', next)
      if (patch?.paths) toolCache = null
      return next
    })

    ctx.actions.register('tool.install', async ({ name }) => {
      if (!TOOL_NAMES.includes(name)) throw new Error('Unknown tool')
      const progress = (pct) => ctx.streams.emit('tool', { name, pct })
      if (name === 'yt-dlp') await updateYtdlp((await tools())['yt-dlp']?.path, progress)
      else await installTool(name, progress)
      return { tools: await tools(true) }
    })

    ctx.actions.register('cache.clear', async (_p, run) => {
      const ws = wsOf(run)
      // Transcripts and yt-dlp info only; clips.json and thumbnails stay (the review page needs them).
      for (const src of await listSources(ws)) {
        for (const f of await fs.readdir(sourceDir(ws, src.id)).catch(() => []))
          if (/^transcript\..+\.json$|^info\.json$|^heatmap\.json$|^signals\.json$|^chat\.json$|^loudness\.json$/.test(f)) await fs.rm(join(sourceDir(ws, src.id), f), { force: true })
        await saveSource(ws, { ...src, transcript: null, status: 'stale' })
      }
      return { cacheBytes: await cacheSize(ws) }
    })

    ctx.logger.info('Stag Clip is ready')
    // Warm the tool check so the first page load is quick.
    void tools(true).catch(() => {})
  },

  async onHealth() {
    return { status: 'ok' }
  }
})

function kindName(k) {
  return { creator: 'creator subtitles', auto: 'auto captions', embedded: 'subtitles inside the file', sidecar: 'subtitle file next to the video', picked: 'subtitle file picked by the user' }[k] ?? k
}

function countStates(clips) {
  const c = { pending: 0, kept: 0, dropped: 0 }
  for (const x of clips) c[x.state] = (c[x.state] ?? 0) + 1
  return c
}

/** Only known keys with sane values. */
function sanitizeSettings(p) {
  const out = {}
  if (p.length in LENGTHS || p.length === 'custom') out.length = p.length
  if (Array.isArray(p.custom) && p.custom.length === 2 && p.custom.every((n) => Number.isFinite(n) && n > 0) && p.custom[0] < p.custom[1]) out.custom = p.custom.map((n) => Math.min(3600, Math.round(n)))
  if (Number.isInteger(p.count) && p.count >= 1 && p.count <= 30) out.count = p.count
  if (p.cutMode === 'precise' || p.cutMode === 'fast') out.cutMode = p.cutMode
  if (Array.isArray(p.langs)) out.langs = p.langs.filter((l) => typeof l === 'string' && /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/.test(l)).slice(0, 10)
  if (typeof p.clipFolder === 'string' && p.clipFolder.trim() && p.clipFolder.length < 400) out.clipFolder = p.clipFolder.trim()
  if (typeof p.publishKept === 'boolean') out.publishKept = p.publishKept
  if (typeof p.firstRunDone === 'boolean') out.firstRunDone = p.firstRunDone
  if (p.paths && typeof p.paths === 'object') out.paths = Object.fromEntries(Object.entries(p.paths).filter(([k, v]) => TOOL_NAMES.includes(k) && typeof v === 'string' && v.length < 500))
  return out
}

runWorker(plugin)
