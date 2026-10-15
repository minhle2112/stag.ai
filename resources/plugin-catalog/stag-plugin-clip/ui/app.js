// Stag Clip review page (slot "review"): sources on the left, the selected video's clips, player and transcript.
// Scenes from design/stag-clip/index.html: review (1), no transcript (3), running (5), first run (6), failed (7).
import { host } from '/__stag/ui.js'
import { $, $$, ago, avatar, closeDropdown, dropdown, errMsg, esc, fmt, ic, toast } from './common.js'
import { setLocale, t } from './i18n.js'

const LENGTHS = ['auto', '15-30', '30-60', '60-180', '180-600']
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi', 'flv', 'ts', 'mts', 'wmv', 'mpg', 'mpeg']
/** After "Find", show the running view until the agent's first clip arrives (or this long). */
const WAIT_AGENT_MS = 15 * 60_000

const S = {
  ws: null,
  sources: [],
  jobs: [],
  settings: {},
  tools: null,
  agents: [],
  sel: null,
  detail: null,
  clipSel: null,
  filter: 'all',
  ask: { length: 'auto', custom: [45, 90], count: 5, agentId: null },
  asked: {},
  busy: new Set(),
  pasteDraft: '',
  queryDraft: {}
}

const store = {
  get: (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(`stagclip:${k}`)) ?? d
    } catch {
      return d
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(`stagclip:${k}`, JSON.stringify(v))
    } catch {
      /* storage may be blocked in the sandboxed frame */
    }
  }
}

// ---------- data ----------

async function loadOverview() {
  if (!S.ws) return
  const o = await host.getData('overview')
  S.sources = o?.sources ?? []
  S.jobs = o?.jobs ?? []
  S.settings = o?.settings ?? {}
  if (S.sel && !S.sources.some((x) => x.id === S.sel)) S.sel = null
  if (!S.sel && S.sources.length) S.sel = pickDefault()
}

function pickDefault() {
  const remembered = store.get(`sel:${S.ws}`, null)
  if (remembered && S.sources.some((x) => x.id === remembered)) return remembered
  return [...S.sources].sort((a, b) => groupOf(a) - groupOf(b))[0]?.id ?? null
}

async function loadDetail() {
  if (!S.sel) {
    S.detail = null
    return
  }
  const d = await host.getData('source', { id: S.sel })
  S.detail = d
  if (d && (!S.clipSel || !d.clips.some((c) => c.id === S.clipSel))) S.clipSel = (d.clips.find((c) => c.state === 'pending') ?? d.clips[0])?.id ?? null
}

async function loadAgents() {
  try {
    const { agents } = await host.agents.list()
    S.agents = agents.filter((a) => a.workspaceId === S.ws && a.kind !== 'terminal')
  } catch {
    S.agents = []
  }
  const saved = store.get(`agent:${S.ws}`, null)
  if (!S.agents.some((a) => a.id === S.ask.agentId)) S.ask.agentId = (S.agents.find((a) => a.id === saved) ?? S.agents.find((a) => a.running) ?? S.agents[0])?.id ?? null
}

async function loadTools() {
  try {
    S.tools = (await host.getData('settings'))?.tools ?? null
  } catch {
    S.tools = null
  }
}

// ---------- grouping ----------

const jobsOf = (id) => S.jobs.filter((j) => j.sourceId === id)
const waitingAgent = (id) => S.asked[id] && Date.now() - S.asked[id] < WAIT_AGENT_MS
/** 0 = needs you, 1 = running, 2 = done. */
function groupOf(src) {
  if (jobsOf(src.id).length || (waitingAgent(src.id) && !(src.counts?.pending + src.counts?.kept + src.counts?.dropped))) return 1
  if (src.status === 'error' || src.status === 'no_transcript' || src.counts?.pending) return 0
  return 2
}

function statusIcon(src) {
  const jobs = jobsOf(src.id)
  if (jobs.length) {
    const pct = Math.round(jobs[0].pct ?? 0)
    return `<span class="n ok tip-l" data-tip="${esc(t('st.running', { pct }))}">${ic('loader-circle', 's', 'spin')}<span class="top">${pct}%</span></span>`
  }
  if (src.status === 'error') return `<span class="n no tip-l" data-tip="${esc(t('st.error'))}">${ic('circle-alert', 's')}</span>`
  if (src.status === 'no_transcript') return `<span class="n warn tip-l" data-tip="${esc(t('st.noSub'))}">${ic('captions-off', 's')}</span>`
  if (waitingAgent(src.id) && !src.counts?.pending && !src.counts?.kept) return `<span class="n ok tip-l" data-tip="${esc(t('run.waitAgent'))}">${ic('loader-circle', 's', 'spin')}</span>`
  if (src.counts?.pending) return `<span class="n warn tip-l" data-tip="${esc(t('st.pending', { n: src.counts.pending }))}">${ic('circle-dashed', 's')}<span>${src.counts.pending}</span></span>`
  if (src.counts?.kept) return `<span class="n ok tip-l" data-tip="${esc(t('st.kept', { n: src.counts.kept }))}">${ic('check', 's')}<span>${src.counts.kept}</span></span>`
  return `<span class="n tip-l" data-tip="${esc(t('st.ready'))}">${ic('circle-check', 's')}</span>`
}

const kindIcon = (src) => (src.kind === 'file' ? 'file-video' : 'globe')
const kindName = (src) => (src.kind === 'file' ? t('kind.file') : src.platform)
const thumbUrl = (src) => (src.thumb ? `${host.fileUrl(src.thumb)}?v=${encodeURIComponent(src.updatedAt ?? '')}` : '')

// ---------- render: shell ----------

function render() {
  closeDropdown()
  const page = $('#page')
  if (!S.ws) {
    page.innerHTML = ''
    return
  }
  if (!S.sources.length) {
    page.innerHTML = `<div class="body">${firstRunHtml()}</div>`
    wireFirstRun()
    return
  }
  if (!$('.src', page)) {
    page.innerHTML = `<aside class="src">
        <div class="hd"><b>${ic('scissors', '')}${esc(t('app.name'))}</b><button class="ib sm tip-l" id="toSet" data-tip="${esc(t('src.settings'))}">${ic('settings', 's')}</button></div>
        <div class="addr">
          <label class="in">${ic('link', 's')}<input id="paste" placeholder="${esc(t('src.paste'))}" spellcheck="false"></label>
          <button class="ib bd" id="pickFile" data-tip="${esc(t('src.pickFile'))}" style="width:30px;height:30px">${ic('folder-open', 's')}</button>
        </div>
        <div class="srows" id="srows"></div>
      </aside><main class="body" id="body"></main>`
    $('#toSet').onclick = () => host.openSettings()
    $('#pickFile').onclick = pickVideo
    const paste = $('#paste')
    paste.value = S.pasteDraft
    paste.oninput = () => (S.pasteDraft = paste.value)
    paste.onkeydown = (e) => {
      if (e.key === 'Enter' && paste.value.trim()) {
        const v = paste.value.trim()
        paste.value = S.pasteDraft = ''
        void addSource(v)
      }
    }
  }
  renderSources()
  renderBody()
}

function renderSources() {
  const row = (s) => `<button class="srow ${s.id === S.sel ? 'sel' : ''}" data-src="${esc(s.id)}">
      <span class="thumb">${s.thumb ? `<img src="${esc(thumbUrl(s))}" alt="">` : ic(kindIcon(s), 's')}${s.duration ? `<i>${fmt(s.duration)}</i>` : ''}</span>
      <span class="tx">${esc(s.title)}</span><span class="st">${statusIcon(s)}</span></button>`
  const groups = [
    [0, t('grp.need')],
    [1, t('grp.run')],
    [2, t('grp.done')]
  ]
  $('#srows').innerHTML = groups
    .map(([g, label]) => {
      const list = S.sources.filter((s) => groupOf(s) === g)
      return list.length ? `<div class="grp">${esc(label)}</div>${list.map(row).join('')}` : ''
    })
    .join('')
  $$('#srows [data-src]').forEach((b) => (b.onclick = () => selectSource(b.dataset.src)))
}

async function selectSource(id) {
  if (id === S.sel) return
  S.sel = id
  S.clipSel = null
  S.filter = 'all'
  store.set(`sel:${S.ws}`, id)
  renderSources()
  await loadDetail().catch(() => (S.detail = null))
  renderBody(true)
}

/** Which scene the selected source shows. */
function sceneOf() {
  const d = S.detail
  if (!d) return 'none'
  const src = d.source
  const jobs = jobsOf(src.id)
  if (jobs.some((j) => j.kind === 'fetch') || (!d.clips.length && jobs.some((j) => j.kind === 'signals'))) return 'running'
  if (src.status === 'error') return 'error'
  if (src.status === 'no_transcript') return 'nosub'
  if (!d.clips.length && (jobs.length || waitingAgent(src.id))) return 'running'
  return 'review'
}

let lastScene = null
function renderBody(force = false) {
  const body = $('#body')
  if (!body) return
  const scene = sceneOf()
  const key = `${S.sel}:${scene}`
  if (!force && key === lastScene && scene === 'review') {
    // Same video, same scene: refresh the parts, keep the player and the ask bar as they are.
    renderHead()
    renderTimeline()
    renderClips()
    renderLines()
    syncPlayer()
    return
  }
  lastScene = key
  if (scene === 'none') body.innerHTML = ''
  else if (scene === 'running') body.innerHTML = runningHtml()
  else if (scene === 'error') body.innerHTML = errorHtml()
  else if (scene === 'nosub') body.innerHTML = noSubHtml()
  else {
    body.innerHTML = `<div class="vh" id="head"></div>${askHtml()}<div class="tl" id="tl"></div>
      <div class="lower"><div class="clips" id="clips"></div>
        <div class="side"><div class="player" id="player"></div><div class="lines" id="lines"></div></div></div>`
    renderHead()
    wireAsk()
    renderTimeline()
    renderClips()
    renderPlayer(true)
    renderLines()
    return
  }
  if (scene !== 'none') wireScene(scene)
}

// ---------- head + ask bar ----------

function headHtml(src, status) {
  const tr = src.transcript
  const chip = tr
    ? `<span class="chip" data-tip="${esc(t('sub.chip', { kind: t(`sub.${tr.kind}`), lang: tr.lang, n: tr.sentences }))}">${ic('captions', 's')}${esc(tr.lang)}</span>`
    : ''
  return `<span class="kind" data-tip="${esc(kindName(src))}">${ic(kindIcon(src), '')}</span><h2 title="${esc(src.title)}">${esc(src.title)}</h2>${chip}${status}
    <button class="ib sm tip-l" id="more" data-tip="${esc(t('head.more'))}">${ic('ellipsis', 's')}</button>`
}

function renderHead() {
  const d = S.detail
  const src = d.source
  const jobs = jobsOf(src.id)
  const status = jobs.length
    ? `<span class="n ok tip-l" data-tip="${esc(jobs[0].kind === 'cut' || jobs[0].kind === 'recut' ? t('run.cutting', { title: jobs[0].title ?? '' }) : t('st.running', { pct: Math.round(jobs[0].pct ?? 0) }))}">${ic('loader-circle', '', 'spin')}</span>`
    : `<span class="n ok tip-l" data-tip="${esc(`${t('head.ready', { n: src.transcript?.sentences ?? 0 })}\n${ago(src.updatedAt)}`)}">${ic('circle-check', '')}</span>`
  $('#head').innerHTML = headHtml(src, status)
  $('#more').onclick = (e) => moreMenu(e.currentTarget)
}

function moreMenu(anchor) {
  const src = S.detail.source
  const first = S.detail.clips[0]
  dropdown(
    anchor,
    [
      ...(first ? [{ label: t('head.openFolder'), icon: 'folder-open', act: () => host.reveal(first.rel).catch(showErr) }] : []),
      ...(src.kind === 'online' ? [{ label: t('head.openSource'), icon: 'globe', act: () => host.openUrl(src.webpageUrl ?? src.url).catch(showErr) }] : []),
      { label: t('head.refetch'), icon: 'refresh-cw', act: () => addSource(src.url ?? src.path, true) },
      'hr',
      { label: t('head.remove'), icon: 'trash-2', danger: true, act: () => removeSource(src.id) }
    ],
    { align: 'right' }
  )
}

const lenLabel = (l, custom) => (l === 'custom' ? t('len.customShort', { a: fmt(custom[0]), b: fmt(custom[1]) }) : t(`len.${l}`))

function askHtml(first = false) {
  const a = S.ask
  const agent = S.agents.find((x) => x.id === a.agentId)
  const dd = `<span class="vr"></span>
    <button class="sel-dd" id="lenDd" data-tip="${esc(t('ask.length'))}">${ic('timer', 's')}<span>${esc(lenLabel(a.length, a.custom))}</span>${ic('chevron-down')}</button>
    <button class="sel-dd" id="countDd" data-tip="${esc(t('ask.count'))}">${ic('hash', 's')}<span>${a.count}</span>${ic('chevron-down')}</button>
    <button class="sel-dd tip-l" id="agentDd" data-tip="${esc(agent ? t('ask.agent', { name: agent.name }) : t('ask.noAgent'))}">${agent ? avatar(agent.name) : ic('circle-alert', 's')}${ic('chevron-down')}</button>`
  if (first) return dd
  const hasClips = !!S.detail?.clips.length
  return `<div class="ask">${ic('sparkles', '')}<input id="query" placeholder="${esc(t('ask.placeholder'))}" value="${esc(S.queryDraft[S.sel] ?? '')}">${dd}
    <button class="ib ${hasClips ? 'bd' : 'send'} tip-l" id="send" data-tip="${esc(hasClips ? t('ask.more') : t('ask.send'))}">${ic('arrow-up', 's')}</button></div>`
}

function wireAskControls(onChange) {
  $('#lenDd').onclick = (e) => {
    const a = S.ask
    dropdown(e.currentTarget, [
      ...LENGTHS.map((l) => ({ label: t(`len.${l}`), on: a.length === l, act: () => setAsk({ length: l }, onChange) })),
      'hr',
      {
        html: `<span>${esc(t('len.min'))}</span><input id="cMin" type="number" min="1" value="${a.custom[0]}"><span>${esc(t('len.max'))}</span><input id="cMax" type="number" min="2" value="${a.custom[1]}">`
      },
      { label: t('len.custom'), on: a.length === 'custom', act: () => {} }
    ])
    const commit = () => {
      const lo = Math.round(+$('#cMin')?.value)
      const hi = Math.round(+$('#cMax')?.value)
      if (lo > 0 && hi > lo) setAsk({ length: 'custom', custom: [lo, hi] }, onChange)
    }
    $$('.dd button').at(-1).onclick = () => {
      commit()
      closeDropdown()
    }
    for (const id of ['#cMin', '#cMax']) $(id).onkeydown = (ev) => ev.key === 'Enter' && (commit(), closeDropdown())
  }
  $('#countDd').onclick = (e) =>
    dropdown(
      e.currentTarget,
      [1, 2, 3, 4, 5, 6, 8, 10, 15].map((n) => ({ label: String(n), on: S.ask.count === n, act: () => setAsk({ count: n }, onChange) }))
    )
  $('#agentDd').onclick = (e) =>
    S.agents.length &&
    dropdown(
      e.currentTarget,
      S.agents.map((a) => ({ label: a.name, icon: a.running ? 'circle-check' : 'circle-dashed', on: S.ask.agentId === a.id, act: () => setAsk({ agentId: a.id }, onChange) })),
      { align: 'right' }
    )
}

function setAsk(patch, onChange) {
  Object.assign(S.ask, patch)
  if (patch.agentId) store.set(`agent:${S.ws}`, patch.agentId)
  onChange()
}

function wireAsk() {
  const q = $('#query')
  q.oninput = () => (S.queryDraft[S.sel] = q.value)
  q.onkeydown = (e) => e.key === 'Enter' && !e.isComposing && sendAsk()
  $('#send').onclick = sendAsk
  wireAskControls(() => {
    const ask = $('.ask')
    if (!ask) return
    const html = askHtml()
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    ask.replaceWith(tmp.firstElementChild)
    wireAsk()
  })
}

async function sendAsk() {
  const src = S.detail?.source
  if (!src) return toast(t('ask.needSource'))
  const agent = S.agents.find((a) => a.id === S.ask.agentId)
  if (!agent) return toast(t('ask.noAgent'), { icon: 'circle-alert' })
  const query = (S.queryDraft[src.id] ?? '').trim()
  try {
    const r = await host.action('ask', { sourceId: src.id, query, length: S.ask.length, custom: S.ask.custom, count: S.ask.count, agentId: agent.id, locale: host.context?.locale ?? 'vi' })
    S.asked[src.id] = Date.now()
    toast(t(`ask.${r.status === 'queued' ? 'queued' : r.status === 'opened' ? 'opened' : 'sent'}`, { name: agent.name }), { icon: 'check' })
    renderSources()
    renderBody()
  } catch (e) {
    showErr(e)
  }
}

// ---------- timeline ----------

function heatPath(heat, dur, upto = 1) {
  if (!heat?.length || !dur) return ''
  const max = Math.max(...heat.map((h) => h.value)) || 1
  const pts = heat.filter((h) => h.start / dur <= upto).map((h) => [((h.start + h.end) / 2 / dur) * 1000, 34 - (h.value / max) * 32])
  if (!pts.length) return ''
  const last = pts[pts.length - 1][0]
  const d = `M0 34 L0 ${pts[0][1].toFixed(1)} ` + pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ` L${last.toFixed(1)} 34Z`
  return `<svg class="hm" viewBox="0 0 1000 34" preserveAspectRatio="none"><path d="${d}" fill="var(--heat-fill)" stroke="var(--heat)" stroke-opacity=".7" stroke-width="1.1" vector-effect="non-scaling-stroke"/></svg>`
}

const axis = (dur) => `<div class="axis">${[0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${fmt(f * dur)}</span>`).join('')}</div>`

function renderTimeline() {
  const { source: src, clips, heatmap } = S.detail
  const dur = src.duration || Math.max(1, ...clips.map((c) => c.end))
  const marks = clips
    .map(
      (c) =>
        `<div class="mk2 ${c.state} ${c.id === S.clipSel ? 'sel' : ''}" data-clip="${esc(c.id)}" style="left:${(c.start / dur) * 100}%;width:max(${((c.end - c.start) / dur) * 100}%,12px)"><span>${c.n}</span></div>`
    )
    .join('')
  $('#tl').innerHTML = `<div class="track">${heatPath(heatmap, dur)}${marks}<div class="ph" id="ph" hidden></div>${axis(dur)}</div>
    <span class="inf tip-l" data-tip="${esc(heatmap?.length ? t('tl.info') : t('tl.infoNoHeat'))}">${ic('info')}</span>`
  $$('#tl [data-clip]').forEach((m) => (m.onclick = () => selectClip(m.dataset.clip)))
  updatePlayhead()
}

// ---------- clips ----------

function shownClips() {
  const f = S.filter
  return S.detail.clips.filter((c) => f === 'all' || c.state === f)
}

function renderClips() {
  const clips = S.detail.clips
  const count = (st) => clips.filter((c) => c.state === st).length
  const pill = (f, inner, tip) => `<button class="pill ${S.filter === f ? 'on' : ''}" data-f="${f}" data-tip="${esc(tip)}">${inner}</button>`
  const shown = shownClips()
  $('#clips').innerHTML = `<div class="lh">
      ${pill('all', `${ic('list', 's')}${clips.length}`, t('f.all'))}
      ${pill('kept', `<span class="ok">${ic('check', 's')}</span>${count('kept')}`, t('f.kept'))}
      ${pill('pending', `<span class="warn">${ic('circle-dashed', 's')}</span>${count('pending')}`, t('f.pending'))}
      ${pill('dropped', `${ic('x', 's')}${count('dropped')}`, t('f.dropped'))}
      <span class="sp"></span>
      <span class="ib" data-tip="${esc(t('keys'))}">${ic('keyboard', 's')}</span>
      <button class="ib" id="keepAll" data-tip="${esc(t('keepAll'))}" ${count('pending') ? '' : 'disabled'}>${ic('check-check', 's')}</button>
      <button class="ib tip-l" id="openDir" data-tip="${esc(t('head.openFolder'))}" ${clips.length ? '' : 'disabled'}>${ic('folder-open', 's')}</button>
    </div>${shown.map(cardHtml).join('')}`
  $$('#clips [data-f]').forEach((b) => (b.onclick = () => ((S.filter = b.dataset.f), renderClips())))
  $('#keepAll').onclick = keepAll
  $('#openDir').onclick = () => clips[0] && host.reveal(clips[0].rel).catch(showErr)
  $$('#clips .card').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return
      selectClip(el.dataset.clip)
    }
  })
  $$('#clips [data-act]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation()
        const [act, id] = b.dataset.act.split(':')
        if (act === 'more') return clipMenu(b, id)
        if (act === 'nudge') return nudge(id, b.dataset.edge, +b.dataset.d)
        const c = S.detail.clips.find((x) => x.id === id)
        if (act === 'keep') decide([id], c.state === 'kept' ? 'pending' : 'kept')
        else if (act === 'drop') decide([id], 'dropped')
        else if (act === 'undo') decide([id], 'pending')
      })
  )
}

function cardHtml(c) {
  const sel = c.id === S.clipSel
  const busy = S.busy.has(c.id)
  const nb = (edge, d, tip) => `<button data-act="nudge:${esc(c.id)}" data-edge="${edge}" data-d="${d}" data-tip="${esc(tip)}">${d < 0 ? '−5' : '+5'}</button>`
  const times = sel
    ? `<span class="rng">${nb('start', -5, t('nudge.startEarlier'))}<span>${fmt(c.start)}</span>${nb('start', 5, t('nudge.startLater'))}</span>${ic('arrow-right')}<span class="rng">${nb('end', -5, t('nudge.endEarlier'))}<span>${fmt(c.end)}</span>${nb('end', 5, t('nudge.endLater'))}</span>`
    : `<span class="times">${fmt(c.start)} – ${fmt(c.end)}</span>`
  const keptTip = c.artifactId ? t('card.keptPublished') : t('card.kept')
  const acts =
    c.state === 'dropped'
      ? `<button class="tg tip-l" data-act="undo:${esc(c.id)}" data-tip="${esc(t('card.restore'))}">${ic('undo-2', 's')}</button>`
      : `<button class="tg more" data-act="more:${esc(c.id)}" data-tip="${esc(t('head.more'))}">${ic('ellipsis', 's')}</button>
         <button class="tg" data-act="drop:${esc(c.id)}" data-tip="${esc(t('card.drop'))}">${ic('x', 's')}</button>
         <button class="tg k tip-l ${c.state === 'kept' ? 'on' : ''}" data-act="keep:${esc(c.id)}" data-tip="${esc(c.state === 'kept' ? keptTip : t('card.keep'))}">${ic('check', 's')}</button>`
  const thumb = c.thumb ? `<img src="${esc(host.fileUrl(c.thumb))}?v=${encodeURIComponent(c.editedAt ?? c.createdAt)}" alt="" loading="lazy">` : ''
  return `<div class="card ${c.state} ${sel ? 'sel' : ''} ${busy ? 'busy' : ''}" data-clip="${esc(c.id)}">
    <div class="pv">${thumb}<span class="no">${c.n}</span><span class="d">${fmt(c.end - c.start)}</span>${busy ? `<span class="busy" data-tip="${esc(t('card.recutting'))}">${ic('loader-circle', '', 'spin')}</span>` : ''}</div>
    <div class="ct"><div class="t1" title="${esc(c.title)}">${esc(c.title)}</div><div class="why" title="${esc(c.reason)}">${esc(c.reason)}</div>
      <div class="row">${times}${sigHtml(c.sig)}${c.agentName ? `<span class="n">${avatar(c.agentName)}</span>` : ''}</div></div>
    <div class="acts">${acts}</div></div>`
}

/** Signals inside a clip, muted mono (scene 1: flame "top 8%", laugh count, loudness). */
function sigHtml(sig) {
  if (!sig) return ''
  const out = []
  if (sig.top) out.push(`<span class="n" data-tip="${esc(t('sig.top', { n: sig.top }))}">${ic('flame', 's')}<span class="top">top ${sig.top}%</span></span>`)
  if (sig.laughs) out.push(`<span class="n" data-tip="${esc(t('sig.laughs', { n: sig.laughs }))}">${ic('laugh', 's')}<span class="top">${sig.laughs}</span></span>`)
  if (sig.loud) out.push(`<span class="n" data-tip="${esc(t('sig.loud', { db: sig.loud }))}">${ic('audio-lines', 's')}</span>`)
  return out.length ? `<span class="gap8">${out.join('')}</span>` : ''
}

function clipMenu(anchor, id) {
  const c = S.detail.clips.find((x) => x.id === id)
  dropdown(
    anchor,
    [
      { label: t('card.reveal'), icon: 'folder-open', act: () => host.reveal(c.rel).catch(showErr) },
      ...(c.state === 'kept' ? [{ label: t('card.unkeep'), icon: 'undo-2', act: () => decide([id], 'pending') }] : [])
    ],
    { align: 'right' }
  )
}

function selectClip(id, { play = false } = {}) {
  if (!id) return
  S.clipSel = id
  renderTimeline()
  renderClips()
  renderPlayer()
  renderLines()
  $(`#clips [data-clip="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  if (play) $('#video')?.play().catch(() => {})
}

async function decide(ids, state, { silent = false } = {}) {
  const src = S.detail.source
  try {
    const r = await host.action('decide', { sourceId: src.id, clipIds: ids, state })
    if (r?.failed?.length && !silent) toast(t('toast.publishFailed', { msg: r.failed[0].error }), { icon: 'circle-alert', ms: 9000 })
    await refresh()
    return r
  } catch (e) {
    showErr(e)
    return null
  }
}

async function keepAll() {
  const ids = S.detail.clips.filter((c) => c.state === 'pending').map((c) => c.id)
  if (!ids.length) return
  const r = await decide(ids, 'kept', { silent: true })
  if (!r) return
  toast(t('toast.kept', { n: ids.length }), {
    icon: 'check-check',
    actions: [{ label: t('toast.undo'), icon: 'undo-2', act: () => decide(ids, 'pending') }]
  })
  if (r.failed?.length) setTimeout(() => toast(t('toast.publishFailed', { msg: r.failed[0].error }), { icon: 'circle-alert', ms: 9000 }), 6500)
}

async function nudge(id, edge, d) {
  const c = S.detail.clips.find((x) => x.id === id)
  if (!c || S.busy.has(id)) return
  const start = edge === 'start' ? Math.max(0, c.start + d) : c.start
  const end = edge === 'end' ? Math.min(S.detail.source.duration ?? Infinity, c.end + d) : c.end
  if (end - start < 1) return
  S.busy.add(id)
  renderClips()
  try {
    await host.action('nudge', { sourceId: S.detail.source.id, clipId: id, start, end })
  } catch (e) {
    showErr(e)
  } finally {
    S.busy.delete(id)
    await refresh()
  }
}

// ---------- player + transcript ----------

let playerClip = null
function renderPlayer(force = false) {
  const c = S.detail.clips.find((x) => x.id === S.clipSel)
  const key = c ? `${c.id}:${c.editedAt ?? c.createdAt}` : null
  if (!force && key === playerClip) return syncPlayer()
  playerClip = key
  const el = $('#player')
  if (!c) {
    el.innerHTML = `<div class="screen">${ic('scissors', 'l')}<span hidden></span></div><div class="ctrl"><span class="t">${esc(t('pl.none'))}</span></div>`
    return
  }
  const loop = store.get('loop', false)
  el.innerHTML = `<div class="screen"><video id="video" preload="metadata" ${loop ? 'loop' : ''} src="${esc(host.fileUrl(c.rel))}?v=${encodeURIComponent(c.editedAt ?? c.createdAt)}"></video><span class="no ${c.state === 'kept' ? 'kept' : ''}" id="pno">${c.n}</span></div>
    <div class="ctrl"><button class="ib sm" id="pp" data-tip="${esc(t('pl.play'))}">${ic('play', 's')}</button><span class="t" id="tnow">0:00</span>
      <span class="scrub" id="scrub"><i id="sfill" style="width:0"></i><b id="sknob" style="left:0"></b></span><span class="t" id="tdur">${fmt(c.end - c.start)}</span>
      <button class="ib sm ${loop ? 'on' : ''}" id="loop" data-tip="${esc(t('pl.loop'))}">${ic('repeat', 's')}</button>
      <button class="ib sm tip-l" id="full" data-tip="${esc(t('pl.full'))}">${ic('maximize-2', 's')}</button></div>`
  const v = $('#video')
  const pp = $('#pp')
  const paint = () => {
    const dur = v.duration || c.end - c.start
    const f = dur ? Math.min(1, v.currentTime / dur) : 0
    $('#sfill').style.width = `${f * 100}%`
    $('#sknob').style.left = `${f * 100}%`
    $('#tnow').textContent = fmt(v.currentTime)
    updatePlayhead()
    markNow()
  }
  v.ontimeupdate = paint
  v.onloadedmetadata = () => ($('#tdur').textContent = fmt(v.duration))
  v.onplay = v.onpause = () => {
    pp.innerHTML = ic(v.paused ? 'play' : 'pause', 's')
    pp.dataset.tip = v.paused ? t('pl.play') : t('pl.pause')
  }
  v.onclick = () => togglePlay()
  pp.onclick = () => togglePlay()
  $('#scrub').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (v.duration) v.currentTime = ((e.clientX - r.left) / r.width) * v.duration
  }
  $('#loop').onclick = (e) => {
    v.loop = !v.loop
    store.set('loop', v.loop)
    e.currentTarget.classList.toggle('on', v.loop)
  }
  $('#full').onclick = () => v.requestFullscreen?.().catch(() => {})
}

function syncPlayer() {
  const c = S.detail?.clips.find((x) => x.id === S.clipSel)
  const no = $('#pno')
  if (c && no) {
    no.textContent = c.n
    no.classList.toggle('kept', c.state === 'kept')
  }
}

function togglePlay() {
  const v = $('#video')
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}

function playAbs() {
  const c = S.detail?.clips.find((x) => x.id === S.clipSel)
  const v = $('#video')
  return c && v ? c.start + v.currentTime : null
}

function updatePlayhead() {
  const ph = $('#ph')
  const at = playAbs()
  const dur = S.detail?.source.duration
  if (!ph || at === null || !dur) return
  ph.hidden = false
  ph.style.left = `${(at / dur) * 100}%`
}

function renderLines() {
  const el = $('#lines')
  const { sentences, clips } = S.detail
  const c = clips.find((x) => x.id === S.clipSel)
  if (!sentences.length) {
    el.innerHTML = ''
    return
  }
  const from = c ? c.start - 45 : 0
  const to = c ? c.end + 45 : 300
  const rows = []
  let startDone = false
  let endDone = false
  for (const [i, s] of sentences.entries()) {
    if (s.end < from || s.start > to) continue
    if (c && !startDone && s.end > c.start) {
      rows.push(`<div class="ln cut"><span class="ts">${ic('arrow-down-to-line')}${fmt(c.start)}</span><span></span></div>`)
      startDone = true
    }
    if (c && startDone && !endDone && s.start >= c.end - 0.3) {
      rows.push(`<div class="ln cut"><span class="ts">${ic('arrow-up-to-line')}${fmt(c.end)}</span><span></span></div>`)
      endDone = true
    }
    const inside = c && s.end > c.start && s.start < c.end
    rows.push(`<div class="ln ${c ? (inside ? 'in' : 'edge') : ''}" data-s="${i}"><span class="ts">${fmt(s.start)}</span><span>${esc(s.text)}</span></div>`)
  }
  if (c && startDone && !endDone) rows.push(`<div class="ln cut"><span class="ts">${ic('arrow-up-to-line')}${fmt(c.end)}</span><span></span></div>`)
  el.innerHTML = rows.join('')
  $$('#lines [data-s]').forEach(
    (r) =>
      (r.onclick = () => {
        const s = sentences[+r.dataset.s]
        const v = $('#video')
        if (!c || !v) return
        const rel = s.start - c.start
        if (rel >= 0 && rel < c.end - c.start) {
          v.currentTime = rel
          v.play().catch(() => {})
        }
      })
  )
  ;(el.querySelector('.ln.cut') ?? el.querySelector('.ln.in'))?.scrollIntoView({ block: 'start' })
  nowIdx = -1
}

let nowIdx = -1
function markNow() {
  const at = playAbs()
  if (at === null) return
  const sentences = S.detail.sentences
  const i = sentences.findIndex((s) => s.start <= at && at < s.end)
  if (i === nowIdx) return
  $(`#lines [data-s="${nowIdx}"]`)?.classList.remove('now')
  nowIdx = i
  const row = $(`#lines [data-s="${i}"]`)
  row?.classList.add('now')
  row?.scrollIntoView({ block: 'nearest' })
}

// ---------- other scenes ----------

function runningHtml() {
  const src = S.detail.source
  const jobs = jobsOf(src.id)
  const fetch = jobs.find((j) => j.kind === 'fetch')
  const sigJob = jobs.find((j) => j.kind === 'signals')
  const cut = jobs.find((j) => j.kind === 'cut')
  const stepIdx = fetch ? 0 : sigJob ? 1 : 2
  const steps = [
    ['captions', t('run.transcript')],
    ['flame', t('run.signals')],
    ['scissors', t('run.cut')]
  ]
  const job = fetch ?? sigJob ?? cut
  const label = cut ? t('run.cutting', { title: cut.title ?? '' }) : fetch ? steps[0][1] : sigJob ? steps[1][1] : t('run.waitAgent')
  const agentName = job?.agentName ?? S.agents.find((a) => a.id === S.ask.agentId)?.name
  const sk = `<div class="card sk"><div class="pv"></div><div class="ct"><div class="bone" style="width:46%"></div><div class="bone" style="width:72%;height:8px"></div><div class="bone" style="width:30%;height:8px"></div></div></div>`
  const dur = src.duration || 1
  const lines = (S.detail.sentences ?? []).slice(0, 40).map((s) => `<div class="ln"><span class="ts">${fmt(s.start)}</span><span>${esc(s.text)}</span></div>`).join('')
  return `<div class="vh">${headHtml(src, `<span class="n ok tip-l" data-tip="${esc(label)}">${ic('loader-circle', '', 'spin')}</span>`)}</div>
    <div class="stepper">${steps
      .map((st, i) => `${i ? `<span class="stpl ${i <= stepIdx ? 'done' : ''}"></span>` : ''}<span class="stp ${i < stepIdx ? 'done' : i === stepIdx ? 'run' : ''}" data-tip="${esc(st[1])}">${ic(st[0], 's')}</span>`)
      .join('')}
      <span class="pct"><b>${esc(label)}</b>${job ? ` · ${Math.round(job.pct ?? 0)}%` : ''}</span><span class="sp"></span>
      ${agentName ? avatar(agentName) : ''}
      ${job ? `<button class="ib bd tip-l" id="stop" data-tip="${esc(t('run.stop'))}">${ic('circle-stop', 's')}</button>` : ''}</div>
    <div class="tl"><div class="track" style="cursor:default">${heatPath(S.detail.heatmap, dur)}${axis(dur)}</div></div>
    <div class="lower"><div class="clips">${sk}${sk}${sk}</div><div class="side"><div class="lines" style="padding-top:10px">${lines}</div></div></div>`
}

function noSubHtml() {
  const src = S.detail.source
  const tip = src.kind === 'file' ? t('noSub.checkedFile') : t('noSub.checkedOnline', { platform: src.platform })
  return `<div class="vh">${headHtml(src, `<span class="n warn tip-l" data-tip="${esc(tip)}">${ic('captions-off', '')}</span>`)}</div>
    <div class="center"><div class="box warn">${ic('captions-off', 'l')}<h3>${esc(t('noSub.title'))}</h3>
      <div class="choices"><button class="choice" id="pickSubs">${ic('file-text', 's')}${esc(t('noSub.pick'))}</button></div>
      <button class="ghost" id="drop">${ic('trash-2', 's')}${esc(t('head.remove'))}</button></div></div>`
}

function errorHtml() {
  const src = S.detail.source
  const err = src.error ?? {}
  const reason = ['login', 'network', 'unavailable', 'unsupported', 'live', 'tool'].includes(err.reason) ? err.reason : 'other'
  const title = t(`err.${reason}`, { tool: err.tool ?? 'ffmpeg' })
  const icon = reason === 'login' ? 'lock' : reason === 'network' ? 'wifi-off' : 'circle-alert'
  let action = `<button class="btn" id="retry">${ic('rotate-ccw', 's')}${esc(t('err.retry'))}</button>`
  if (reason === 'login')
    action = `<button class="btn" id="login">${ic('log-in', 's')}${esc(t('err.loginHint', { platform: src.platform }))}</button><button class="ib bd" id="retry" data-tip="${esc(t('err.retryLogin'))}">${ic('rotate-ccw', 's')}</button>`
  if (reason === 'tool') action = `<button class="btn pri" id="install" data-tool="${esc(err.tool ?? 'ffmpeg')}">${ic('download', 's')}${esc(t('tool.install'))}</button>`
  if (reason === 'unavailable' || reason === 'unsupported') action = ''
  return `<div class="vh">${headHtml(src, `<span class="n no tip-l" data-tip="${esc(t('st.error'))}">${ic('circle-alert', '')}</span>`)}</div>
    <div class="center"><div class="box bad">${ic(icon, 'l')}<h3>${esc(title)}</h3><p class="msg">${esc(err.message ?? '')}</p>
      <span class="gap8">${action}<button class="ghost" id="drop" style="margin:0 0 0 6px">${ic('trash-2', 's')}${esc(t('head.remove'))}</button></span></div></div>`
}

function wireScene(scene) {
  $('#more') && ($('#more').onclick = (e) => moreMenu(e.currentTarget))
  const src = S.detail.source
  if (scene === 'running') $('#stop') && ($('#stop').onclick = () => jobsOf(src.id).forEach((j) => host.action('stop', { jobId: j.id }).catch(() => {})))
  if (scene === 'nosub') {
    $('#pickSubs').onclick = async () => {
      const file = await host.pickFile(t('pick.subs'), [{ name: t('filter.subs'), extensions: ['srt', 'vtt'] }])
      if (!file) return
      try {
        await host.action('pickTranscript', { sourceId: src.id, file })
        await refresh(true)
      } catch (e) {
        showErr(e)
      }
    }
  }
  if (scene === 'error') {
    $('#retry') && ($('#retry').onclick = () => addSource(src.url ?? src.path, true))
    $('#login') && ($('#login').onclick = () => host.openUrl(src.webpageUrl ?? src.url).catch(showErr))
    $('#install') && ($('#install').onclick = (e) => install(e.currentTarget.dataset.tool, () => addSource(src.url ?? src.path, true)))
  }
  $('#drop') && ($('#drop').onclick = () => removeSource(src.id))
}

function firstRunHtml() {
  const missing = S.tools ? ['yt-dlp', 'ffmpeg'].filter((n) => !S.tools[n]?.path) : []
  return `<div class="center first"><div class="box">${ic('scissors', 'l')}<h3>${esc(t('first.title'))}</h3>
    <div class="paste">${ic('link', 's')}<input id="fUrl" placeholder="${esc(t('first.paste'))}" spellcheck="false" value="${esc(S.pasteDraft)}">
      <button class="ib bd tip-l" id="fFile" data-tip="${esc(t('src.pickFile'))}">${ic('folder-open', 's')}</button>
      <button class="ib bd tip-l send" id="fGo" data-tip="${esc(t('first.go'))}">${ic('arrow-up', 's')}</button></div>
    <div class="paste q">${ic('sparkles', 's')}<input id="fQuery" placeholder="${esc(t('ask.placeholder'))}" value="${esc(S.queryDraft.first ?? '')}"></div>
    <div class="opts1">${askHtml(true)}</div>
    ${missing.map((n) => `<div class="miss">${ic('circle-alert', 's')}<span>${esc(t('tool.missing', { tool: n })).replace(esc(n), `<b>${esc(n)}</b>`)}</span><button class="btn pri" data-install="${esc(n)}">${ic('download', 's')}${esc(t('tool.install'))}</button></div>`).join('')}
    <div class="legal">${ic('info')}${esc(t('first.legal'))}</div></div></div>`
}

function wireFirstRun() {
  const url = $('#fUrl')
  const q = $('#fQuery')
  url.oninput = () => (S.pasteDraft = url.value)
  q.oninput = () => (S.queryDraft.first = q.value)
  const go = async () => {
    const v = url.value.trim()
    if (!v) return url.focus()
    url.value = S.pasteDraft = ''
    const id = await addSource(v)
    if (id && S.agents.length) {
      S.queryDraft[id] = q.value
      await sendAsk()
    }
  }
  url.onkeydown = (e) => e.key === 'Enter' && go()
  q.onkeydown = (e) => e.key === 'Enter' && !e.isComposing && go()
  $('#fGo').onclick = go
  $('#fFile').onclick = pickVideo
  wireAskControls(() => {
    $('.opts1').innerHTML = askHtml(true)
    wireFirstRun()
  })
  $$('[data-install]').forEach((b) => (b.onclick = () => install(b.dataset.install, () => render())))
}

// ---------- actions ----------

async function addSource(input, refetch = false) {
  try {
    const p = host.action('fetch', { input })
    // the worker's job shows up in the jobs stream right away; refresh so "running" appears
    setTimeout(() => void refresh(), 300)
    const r = await p
    await refresh()
    if (r?.id && (!refetch || r.id !== S.sel)) await selectSource(r.id)
    return r?.id ?? null
  } catch (e) {
    showErr(e)
    await refresh()
    return null
  }
}

async function pickVideo() {
  const file = await host.pickFile(t('pick.video'), [{ name: t('filter.video'), extensions: VIDEO_EXT }])
  if (file) await addSource(file)
}

async function removeSource(id) {
  try {
    await host.action('remove', { sourceId: id })
    if (S.sel === id) {
      S.sel = null
      S.detail = null
    }
    await refresh(true)
  } catch (e) {
    showErr(e)
  }
}

async function install(tool, then) {
  const off = host.on('tool', (d) => d?.name === tool && toast(t('tool.installing', { tool, pct: d.pct ?? 0 }), { icon: 'download', ms: 60_000 }))
  try {
    toast(t('tool.installing', { tool, pct: 0 }), { icon: 'download', ms: 60_000 })
    await host.action('tool.install', { name: tool })
    $('.toast')?.remove()
    await loadTools()
    then?.()
  } catch (e) {
    showErr(e)
  } finally {
    off()
  }
}

function showErr(e) {
  toast(errMsg(e), { icon: 'circle-alert', ms: 9000 })
}

let refreshing = null
let again = false
async function refresh(force = false) {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    try {
      await loadOverview()
      await loadDetail()
    } catch (e) {
      console.warn(e)
    }
    if (force) lastScene = null
    render()
  })()
  await refreshing
  refreshing = null
  if (again) {
    again = false
    await refresh()
  }
}

// ---------- keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return
  if (!S.detail || sceneOf() !== 'review') return
  const list = shownClips()
  const i = list.findIndex((c) => c.id === S.clipSel)
  const c = list[i]
  const k = e.key
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault()
    const next = list[Math.max(0, Math.min(list.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]
    if (next) selectClip(next.id)
  } else if (k === ' ') {
    e.preventDefault()
    togglePlay()
  } else if (!c) return
  else if (k === 'g' || k === 'G') decide([c.id], c.state === 'kept' ? 'pending' : 'kept')
  else if (k === 'b' || k === 'B') decide([c.id], 'dropped')
  else if (k === '[') nudge(c.id, 'start', -5)
  else if (k === ']') nudge(c.id, 'start', 5)
  else if (k === '{') nudge(c.id, 'end', -5)
  else if (k === '}') nudge(c.id, 'end', 5)
})

// ---------- start ----------

let srcTimer = null
host.on('sources', (d) => {
  if (d?.workspaceId && d.workspaceId !== S.ws) return
  clearTimeout(srcTimer)
  srcTimer = setTimeout(() => void refresh(), 150)
})
host.on('jobs', (d) => {
  if (d?.workspaceId && d.workspaceId !== S.ws) return
  const before = S.jobs.map((j) => j.id).join()
  S.jobs = d?.jobs ?? []
  if (!$('#srows')) return
  renderSources()
  // progress only: update the stepper text in place; a job starting / ending re-renders the scene
  if (before !== S.jobs.map((j) => j.id).join()) renderBody()
  else {
    const pct = $('.stepper .pct')
    const job = S.detail && jobsOf(S.detail.source.id)[0]
    if (pct && job) pct.lastChild && (pct.lastChild.textContent = ` · ${Math.round(job.pct ?? 0)}%`)
  }
})
host.onLocale((l) => {
  setLocale(l)
  lastScene = null
  $('#page').innerHTML = ''
  render()
})

async function start(ctx) {
  setLocale(ctx.locale)
  const ws = ctx.workspace?.id ?? null
  if (ws !== S.ws) {
    S.ws = ws
    S.sel = null
    S.detail = null
    S.asked = {}
    lastScene = null
    $('#page').innerHTML = ''
  }
  const st = (await host.getData('settings').catch(() => null)) ?? {}
  S.tools = st.tools ?? null
  const s = st.settings ?? {}
  S.ask.length = s.length ?? 'auto'
  S.ask.custom = s.custom ?? [45, 90]
  S.ask.count = s.count ?? 5
  await Promise.all([loadAgents(), loadOverview()])
  await loadDetail().catch(() => {})
  render()
}

host.onContext((ctx) => void start(ctx))
void host.ready.then(start)
