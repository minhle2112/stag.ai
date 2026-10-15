// Stag Clip settings page (slot "settings", Settings → Plugins → Stag Clip): tools, defaults, storage.
import { host } from '/__stag/ui.js'
import { $, $$, bytes, dropdown, errMsg, esc, ic, toast } from './common.js'
import { setLocale, t } from './i18n.js'

const LENGTHS = ['auto', '15-30', '30-60', '60-180', '180-600']
let D = null
let installing = {}

async function load() {
  D = await host.getData('settings')
  render()
}

async function save(patch) {
  try {
    D.settings = await host.action('settings.set', { patch })
    if (patch.paths) D = await host.getData('settings')
    render()
  } catch (e) {
    toast(errMsg(e), { icon: 'circle-alert' })
  }
}

function toolRow(name) {
  const tl = D.tools?.[name] ?? {}
  const busy = installing[name]
  let ver
  if (busy !== undefined) ver = `<span class="prog">${ic('loader-circle', 'xs', 'spin')} ${busy}%</span>`
  else if (!tl.path) ver = `<span class="ver bad">${ic('circle-alert')}${esc(t('set.missing'))}</span>`
  else if (tl.outdated) ver = `<span class="ver warn" data-tip="${esc(t('set.outdatedTip'))}">${ic('circle-alert')}${esc(t('set.outdated', { v: tl.version ?? '?' }))}</span>`
  else ver = `<span class="ver" data-tip="${esc(tl.path)}">${ic('circle-check')}${esc(tl.version ?? '?')}</span>`
  const canInstall = name !== 'ffprobe'
  let act = ''
  if (busy === undefined && canInstall) {
    if (!tl.path) act = `<button class="btn pri" data-install="${name}" style="height:26px">${ic('download', 's')}${esc(t('set.install'))}</button>`
    else if (name === 'yt-dlp') act = `<button class="${tl.outdated ? 'btn pri' : 'ib sm tip-l'}" data-install="${name}" data-tip="${esc(t('set.update'))}" ${tl.outdated ? 'style="height:26px"' : ''}>${ic('refresh-cw', 's')}${tl.outdated ? esc(t('set.update')) : ''}</button>`
  }
  const own = D.settings.paths?.[name]
  return `<div class="f"><div class="k">${name}</div><div class="v">${ver}${own ? `<input class="path" data-path="${name}" value="${esc(own)}" placeholder="${esc(t('set.pathPlaceholder', { tool: name }))}">` : ''}</div>${act}
    <button class="ib sm tip-l" data-edit="${name}" data-tip="${esc(t('set.path'))}">${ic('pencil', 's')}</button></div>`
}

function render() {
  const s = D.settings
  const len = s.length === 'custom' ? `${s.custom[0]}–${s.custom[1]} s` : t(`len.${s.length}`)
  $('#root').innerHTML = `<div class="sbody">
    <div class="sec"><div class="h">${esc(t('set.tools'))}</div>${['yt-dlp', 'ffmpeg', 'ffprobe'].map(toolRow).join('')}</div>
    <div class="sec"><div class="h">${esc(t('set.defaults'))}</div>
      <div class="f"><div class="k">${esc(t('set.length'))}</div><div class="v"><button class="sel-dd" id="len">${ic('timer', 's')}${esc(len)}${ic('chevron-down')}</button></div></div>
      <div class="f"><div class="k">${esc(t('set.count'))}</div><div class="v"><input class="num" id="count" type="number" min="1" max="30" value="${s.count}"></div></div>
      <div class="f"><div class="k">${esc(t('set.cutMode'))}</div><div class="v"><div class="seg">
        <button class="${s.cutMode !== 'fast' ? 'on' : ''}" data-mode="precise" data-tip="${esc(t('set.preciseTip'))}">${ic('crosshair', 'xs')}${esc(t('set.precise'))}</button>
        <button class="${s.cutMode === 'fast' ? 'on' : ''}" data-mode="fast" data-tip="${esc(t('set.fastTip'))}">${ic('zap', 'xs')}${esc(t('set.fast'))}</button></div></div></div>
      <div class="f"><div class="k tip-r" data-tip="${esc(t('set.langsTip'))}">${esc(t('set.langs'))}</div><div class="v">
        ${(s.langs ?? []).map((l) => `<span class="chip">${esc(l)}<button data-rm="${esc(l)}" data-tip="${esc(t('set.removeLang'))}">${ic('x', 'xs')}</button></span>`).join('')}
        <input class="lang-in" id="lang" placeholder="vi, en…" maxlength="8"><button class="ib sm" id="addLang" data-tip="${esc(t('set.addLang'))}">${ic('plus', 's')}</button></div></div>
    </div>
    <div class="sec"><div class="h">${esc(t('set.storage'))}</div>
      <div class="f"><div class="k" data-tip="${esc(t('set.clipFolderTip'))}">${esc(t('set.clipFolder'))}</div><div class="v"><input class="path" id="folder" value="${esc(s.clipFolder)}"></div></div>
      <div class="f"><div class="k">${esc(t('set.cache'))}</div><div class="v"><span class="mono" style="color:var(--muted);font-size:12px">${D.cacheBytes === null ? esc(t('set.noWorkspace')) : bytes(D.cacheBytes)}</span></div>
        <button class="ib sm tip-l" id="clear" data-tip="${esc(t('set.clearCache'))}" ${D.cacheBytes ? '' : 'disabled'}>${ic('trash-2', 's')}</button></div>
      <div class="f"><div class="k">${esc(t('set.publishKept'))}</div><div class="v"></div><button class="toggle ${s.publishKept ? 'on' : ''}" id="publish" role="switch" aria-checked="${!!s.publishKept}" aria-label="${esc(t('set.publishKept'))}"></button></div>
    </div></div>`
  wire()
}

function wire() {
  const s = D.settings
  $('#len').onclick = (e) =>
    dropdown(
      e.currentTarget,
      LENGTHS.map((l) => ({ label: t(`len.${l}`), on: s.length === l, act: () => save({ length: l }) }))
    )
  $('#count').onchange = (e) => {
    const n = Math.round(+e.target.value)
    if (n >= 1 && n <= 30) save({ count: n })
  }
  $$('[data-mode]').forEach((b) => (b.onclick = () => save({ cutMode: b.dataset.mode })))
  $$('[data-rm]').forEach((b) => (b.onclick = () => save({ langs: (s.langs ?? []).filter((l) => l !== b.dataset.rm) })))
  const addLang = () => {
    const v = $('#lang').value.trim().toLowerCase()
    if (/^[a-z]{2,3}([-_][a-z]{2,4})?$/.test(v) && !(s.langs ?? []).includes(v)) save({ langs: [...(s.langs ?? []), v] })
  }
  $('#addLang').onclick = addLang
  $('#lang').onkeydown = (e) => e.key === 'Enter' && addLang()
  $('#folder').onchange = (e) => e.target.value.trim() && save({ clipFolder: e.target.value.trim() })
  $('#publish').onclick = () => save({ publishKept: !s.publishKept })
  $('#clear').onclick = async () => {
    try {
      const r = await host.action('cache.clear')
      D.cacheBytes = r.cacheBytes
      render()
    } catch (e) {
      toast(errMsg(e), { icon: 'circle-alert' })
    }
  }
  $$('[data-install]').forEach((b) => (b.onclick = () => install(b.dataset.install)))
  $$('[data-edit]').forEach(
    (b) =>
      (b.onclick = () => {
        const name = b.dataset.edit
        if (!(D.settings.paths ?? {})[name]) {
          D.settings.paths = { ...(D.settings.paths ?? {}), [name]: D.tools?.[name]?.path ?? '' }
          render()
        }
        $(`[data-path="${name}"]`)?.focus()
      })
  )
  $$('[data-path]').forEach(
    (inp) =>
      (inp.onchange = () => {
        const paths = { ...(D.settings.paths ?? {}) }
        if (inp.value.trim()) paths[inp.dataset.path] = inp.value.trim()
        else delete paths[inp.dataset.path]
        save({ paths })
      })
  )
}

async function install(name) {
  installing[name] = 0
  render()
  const off = host.on('tool', (d) => {
    if (d?.name !== name) return
    installing[name] = d.pct ?? 0
    render()
  })
  try {
    const r = await host.action('tool.install', { name })
    D.tools = r.tools
  } catch (e) {
    toast(errMsg(e), { icon: 'circle-alert', ms: 9000 })
  } finally {
    off()
    delete installing[name]
    render()
  }
}

host.onLocale((l) => {
  setLocale(l)
  if (D) render()
})
host.onContext(() => void load())
void host.ready.then((ctx) => {
  setLocale(ctx.locale)
  return load()
})
