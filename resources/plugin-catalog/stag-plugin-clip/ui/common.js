// Helpers shared by Stag Clip's pages.
import { SPRITE } from './icons.js'
import { t } from './i18n.js'

document.body.insertAdjacentHTML('afterbegin', SPRITE)

export const $ = (s, root = document) => root.querySelector(s)
export const $$ = (s, root = document) => [...root.querySelectorAll(s)]

/** Lucide icon from the sprite (icons.js, generated from lucide-static 1.48.0). */
export const ic = (name, size = 'xs', extra = '') => `<svg class="ic ${size} ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

/** 3725 → "1:02:05", 65 → "1:05". */
export function fmt(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s % 60).padStart(2, '0')
}

export function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return t('ago.now')
  if (ms < 3_600_000) return t('ago.min', { n: Math.round(ms / 60_000) })
  if (ms < 86_400_000) return t('ago.hour', { n: Math.round(ms / 3_600_000) })
  return t('ago.day', { n: Math.round(ms / 86_400_000) })
}

export function bytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`
}

const AV = ['var(--accent)', 'var(--wait)', 'var(--p3)', 'var(--info)', 'var(--p1)', 'var(--work)']
/** Agent avatar: first letter, colour from the name, name in the tooltip. */
export function avatar(name, cls = '') {
  if (!name) return ''
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return `<span class="av ${cls}" style="background:${AV[h % AV.length]}" data-tip="${esc(name)}">${esc([...name.trim()][0]?.toUpperCase() ?? '?')}</span>`
}

/** Small dropdown menu next to `anchor`. items: [{ label, icon?, on?, danger?, act }] or 'hr' or { html }. */
let openDd = null
export function dropdown(anchor, items, { align = 'left' } = {}) {
  closeDropdown()
  const dd = document.createElement('div')
  dd.className = 'dd'
  dd.innerHTML = items
    .map((it, i) =>
      it === 'hr'
        ? '<hr>'
        : it.html
          ? `<div class="row">${it.html}</div>`
          : `<button type="button" data-i="${i}" class="${it.on ? 'on' : ''} ${it.danger ? 'dan' : ''}">${it.icon ? ic(it.icon, 's') : ''}${esc(it.label)}${it.on ? ic('check', 'xs', 'chk') : ''}</button>`
    )
    .join('')
  document.body.appendChild(dd)
  const r = anchor.getBoundingClientRect()
  const w = dd.offsetWidth
  const h = dd.offsetHeight
  let left = align === 'right' ? r.right - w : r.left
  left = Math.max(6, Math.min(left, window.innerWidth - w - 6))
  let top = r.bottom + 4
  if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 4)
  dd.style.left = `${left}px`
  dd.style.top = `${top}px`
  dd.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]')
    if (!b) return
    const it = items[+b.dataset.i]
    closeDropdown()
    it.act?.()
  })
  openDd = dd
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0)
  return dd
}
function outside(e) {
  if (openDd && !openDd.contains(e.target)) closeDropdown()
}
export function closeDropdown() {
  openDd?.remove()
  openDd = null
  document.removeEventListener('mousedown', outside, true)
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDropdown()
})

/** Bottom toast. actions: [{ label, icon, act }]. */
let toastTimer = null
export function toast(text, { icon = 'info', actions = [], ms = 6000 } = {}) {
  $('.toast')?.remove()
  clearTimeout(toastTimer)
  const el = document.createElement('div')
  el.className = `toast ${actions.length ? '' : 'only'}`
  el.innerHTML = `${ic(icon, 's')}<span>${esc(text)}</span>${actions.map((a, i) => `<button class="btn" data-a="${i}" style="height:26px">${a.icon ? ic(a.icon, 's') : ''}${esc(a.label)}</button>`).join('')}`
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]')
    if (!b) return
    el.remove()
    actions[+b.dataset.a].act()
  })
  ;(document.querySelector('.body') ?? document.body).appendChild(el)
  toastTimer = setTimeout(() => el.remove(), ms)
}

export const errMsg = (e) => String(e?.message ?? e).replace(/^Error:\s*/, '')
