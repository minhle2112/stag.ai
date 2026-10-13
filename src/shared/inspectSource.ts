// Chế độ Soi — tìm nguồn của phần tử: đọc thuộc tính data-stag-src (plugin dev server, mu-plugin WordPress) và khớp
// HTML tĩnh với file trong dự án. Logic thuần, dùng chung cho preload của trang và main; test bằng vitest.
import type { InspectSource } from './inspect'

/**
 * Đọc giá trị data-stag-src / data-src:
 * - "src/App.tsx:42:5" (plugin Vite / Next) · "site/index.html:29"
 * - "themes/child/header.php:4" · "themes/parent/footer.php:6 · (parent theme)" · "plugins/x/views/item.php:3 · …"
 * - "post:12 · block 3 · core/paragraph" · "template-part:header · core/template-part" · "template · block 2 · core/group"
 */
export function parseSrc(raw: string, inherited = false): InspectSource {
  const label = raw.slice(0, 300)
  const parts = raw.split(' · ').map((s) => s.trim())
  const head = parts[0]
  const inh = inherited ? { inherited: true as const } : {}
  const post = /^post:(\d+)$/.exec(head)
  if (post) {
    const block = parts.find((p) => /^[a-z0-9-]+\/[a-z0-9-]+$/.test(p))
    const order = parts.find((p) => /^block \d+$/.test(p))
    return {
      chip: 'wp',
      label: `Block ${block ?? ''} · bài #${post[1]}${order ? ` · ${order}` : ''}`.replace('Block  ·', 'Block ·'),
      effect: `Nội dung bài #${post[1]} trong cơ sở dữ liệu · có bản sửa (revision), hoàn tác được`,
      hint: `WordPress post ${post[1]}, ${block ?? 'block'}${order ? ` (${order} in render order)` : ''}: edit post_content with WP-CLI on the local copy (wp post get ${post[1]} --field=post_content / wp post update), a revision is kept.`,
      ...inh
    }
  }
  const part = /^template-part:([\w-]+)$/.exec(head)
  if (part)
    return {
      chip: 'wp',
      label: `Template part "${part[1]}"`,
      effect: 'Template part của block theme · đổi ở mọi trang dùng phần này',
      hint: `Block-theme template part "${part[1]}": if it was edited in the Site Editor it lives in the DB (wp_template_part post, slug ${part[1]}), otherwise in the theme's parts/${part[1]}.html (edit the child theme).`,
      ...inh
    }
  if (head === 'template')
    return {
      chip: 'wp',
      label: `Template · ${parts.slice(1).join(' · ')}`,
      effect: 'Template của block theme · đổi ở mọi trang dùng template này',
      hint: 'Block-theme template (wp_template post if edited in the Site Editor, else the theme templates/*.html); edit the child theme.',
      ...inh
    }
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(head)
  const file = (m ? m[1] : head).replace(/\\/g, '/')
  const line = m ? Number(m[2]) : undefined
  const wpFile = /(^|\/)wp-content\/|^themes\/|^plugins\/|^mu-plugins\//.test(file)
  const chip: InspectSource['chip'] = wpFile ? (/(^|\/)(mu-)?plugins\//.test(file) ? 'plugin' : 'theme') : /\.html?$/i.test(file) ? 'html' : 'code'
  const parent = chip === 'theme' && parts.slice(1).some((r) => /parent|theme cha/i.test(r))
  return {
    chip,
    label,
    file,
    ...(line ? { line } : {}),
    ...(chip === 'theme'
      ? parent
        ? {
            effect: 'Theme cha · sửa thẳng sẽ mất khi cập nhật theme → agent chép sang child theme trước',
            hint: `Parent theme file wp-content/${file}: never edit it in place — copy it into the child theme (create one if missing) and edit the copy.`
          }
        : { effect: 'Theme · áp dụng cho mọi trang dùng phần này', hint: `Theme file wp-content/${file}${line ? ` around line ${line}` : ''}.` }
      : chip === 'plugin'
        ? { effect: 'Template của plugin · áp dụng cho mọi trang dùng phần này', hint: `Plugin file wp-content/${file}: a plugin update overwrites edits — prefer a theme override / hook if the plugin supports it.` }
        : {}),
    ...inh
  }
}

/** Một thẻ mở trong file HTML tĩnh. */
export interface StaticTag {
  /** tên thẻ chữ thường */
  t: string
  id: string
  /** lớp, sắp xếp, cách bằng dấu cách */
  c: string
  line: number
}

const VOID_SKIP = new Set(['html', 'head', 'meta', 'link', 'title', 'script', 'style', 'base', 'noscript', 'template'])

/** Thẻ mở (theo thứ tự trong file) của một trang HTML tĩnh, bỏ chú thích / <script> / <style>. */
export function staticTags(html: string): StaticTag[] {
  const out: StaticTag[] = []
  let line = 1
  let last = 0
  const lineAt = (off: number): number => {
    for (let k = last; k < off; k++) if (html.charCodeAt(k) === 10) line++
    last = off
    return line
  }
  const re = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(html))) {
    if (!mm[2]) continue
    const t = mm[2].toLowerCase()
    if (VOID_SKIP.has(t)) continue
    const attrs = mm[3] ?? ''
    const id = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const cls = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    out.push({
      t,
      id: id ? (id[1] ?? id[2] ?? id[3] ?? '') : '',
      c: cls ? classKey(cls[1] ?? cls[2] ?? cls[3] ?? '') : '',
      line: lineAt(mm.index)
    })
  }
  return out
}

export function classKey(cls: string): string {
  return cls.split(/\s+/).filter(Boolean).sort().join(' ')
}

/** Khoá so khớp phần tử ↔ thẻ trong file. */
export function tagKey(t: { t: string; id: string; c: string }): string {
  return `${t.t}#${t.id}.${t.c}`
}

/** Thư mục thường chứa trang tĩnh, thử lần lượt. */
export const STATIC_ROOTS = ['', 'public', 'site', 'dist', 'docs', 'www', 'src', 'static', 'build', 'out', 'html']

/** File có thể ứng với đường dẫn URL (tương đối, dấu /): "/" → index.html; "/a" → a, a.html, a/index.html. */
export function staticCandidates(pathname: string): string[] {
  let p = pathname
  try {
    p = decodeURIComponent(pathname)
  } catch {
    // giữ nguyên
  }
  p = p.replace(/\\/g, '/').replace(/^\/+/, '')
  if (p.split('/').some((s) => s === '..')) return []
  if (!p || p.endsWith('/')) return [`${p}index.html`]
  if (/\.html?$/i.test(p)) return [p]
  if (/\.[a-z0-9]+$/i.test(p)) return []
  return [`${p}.html`, `${p}/index.html`]
}
