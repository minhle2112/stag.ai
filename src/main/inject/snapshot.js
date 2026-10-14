// Chạy TRONG trang qua executeJavaScript (nạp nguyên văn bằng ?raw, không qua bundler).
// Trả về bản tóm tắt trang dạng chữ cho agent: chữ theo khối, mỗi phần tử bấm/gõ được có số [ref]
// gắn vào thuộc tính data-stag-ref để browser_click / browser_type tìm lại.
(function snapshotPage(maxChars) {
  for (const el of document.querySelectorAll('[data-stag-ref]')) el.removeAttribute('data-stag-ref')

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'HEAD'])
  const BLOCK = new Set([
    'P', 'DIV', 'LI', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE', 'FORM', 'TABLE',
    'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'DT', 'DD', 'FIELDSET', 'FIGURE', 'FIGCAPTION', 'DIALOG', 'BR', 'HR'
  ])
  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true],' +
    '[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],[role=textbox]'

  const lines = []
  let cur = ''
  let ref = 0
  const flush = () => {
    const t = cur.replace(/\s+/g, ' ').trim()
    if (t) lines.push(t)
    cur = ''
  }
  const clean = (s, n = 100) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

  function describe(el) {
    const tag = el.tagName
    const role = el.getAttribute('role')
    const input = el
    const name =
      clean(el.getAttribute('aria-label')) ||
      clean(el.labels?.[0]?.innerText) ||
      clean(el.getAttribute('placeholder')) ||
      clean(el.innerText) ||
      clean(el.getAttribute('title')) ||
      clean(el.getAttribute('alt')) ||
      clean(el.getAttribute('name'))
    let kind = role ?? tag.toLowerCase()
    let extra = ''
    if (tag === 'A') {
      kind = 'link'
      const href = el.getAttribute('href') ?? ''
      if (href && !href.startsWith('javascript:')) extra = ` → ${href.slice(0, 120)}`
    } else if (tag === 'INPUT') {
      const type = (input.type || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') {
        kind = `${type} ${input.checked ? '[x]' : '[ ]'}`
      } else if (type === 'submit' || type === 'button' || type === 'reset') {
        kind = 'button'
        return `${kind} "${clean(input.value) || name}"`
      } else {
        kind = `textbox(${type})`
        // Ô mật khẩu, ô mã 2FA và ô kho mật khẩu của stag.ai đã điền: không đọc giá trị.
        const secret = type === 'password' || el.hasAttribute('data-stag-secret') || /one-time-code/.test(el.autocomplete || '')
        if (input.value) extra = secret ? ' = "•••••• (hidden by stag.ai)"' : ` = "${clean(input.value, 80)}"`
      }
    } else if (tag === 'TEXTAREA') {
      kind = 'textbox(multiline)'
      if (input.value) extra = ` = "${clean(input.value, 80)}"`
    } else if (tag === 'SELECT') {
      const sel = el
      kind = 'select'
      extra = ` = "${clean(sel.selectedOptions[0]?.text)}" (${sel.options.length} options)`
    } else if (el.isContentEditable) {
      kind = 'textbox(rich)'
    }
    if (el.disabled) extra += ' (disabled)'
    return `${kind} "${name}"${extra}`
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      cur += ' ' + (node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node
    if (SKIP.has(el.tagName.toUpperCase())) return
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) return

    if (el.matches(INTERACTIVE)) {
      flush()
      ref += 1
      el.setAttribute('data-stag-ref', String(ref))
      lines.push(`[${ref}] ${describe(el)}`)
      return
    }
    const heading = /^H([1-6])$/.exec(el.tagName)
    if (heading) {
      flush()
      lines.push(`${'#'.repeat(Number(heading[1]))} ${clean(el.innerText, 200)}`)
      return
    }
    const block = BLOCK.has(el.tagName)
    if (block) flush()
    if (el.tagName === 'TD' || el.tagName === 'TH') cur += ' | '
    if (el.tagName === 'IMG' && el.getAttribute('alt')) cur += ` [image: ${clean(el.getAttribute('alt'), 60)}]`
    for (const child of el.childNodes) walk(child)
    if (block) flush()
  }

  if (document.body) walk(document.body)
  flush()

  const deduped = lines.filter((l, i) => l !== lines[i - 1])
  let out = `URL: ${location.href}\nTitle: ${document.title}\n\n${deduped.join('\n')}`
  if (out.length > maxChars) out = out.slice(0, maxChars) + `\n… (truncated, page is ${out.length} characters long)`
  return out
})
