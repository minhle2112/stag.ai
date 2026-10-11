// Markdown của tin assistant trong ô chat → HTML. Riêng với vault/markdown.ts (không có wikilink / frontmatter,
// không tự bẻ dòng): cùng markdown-it, `html: false` nên chữ thô trong tin luôn bị escape.
//
// Nét riêng: khối code có tiêu đề (ngôn ngữ + nút Sao chép, bắt bằng ủy quyền sự kiện ở Markdown.tsx), tô màu nhẹ
// dùng lại artifacts/code.ts, link không có href (app tự mở http(s) bằng window.open), bảng bọc khung cuộn ngang,
// việc cần làm `- [ ]`, và con trỏ nhấp nháy khi đang stream.
import MarkdownIt from 'markdown-it'
import type { StateCore } from 'markdown-it'
import { ICONS } from '../icons'
import { escapeHtml, highlightLines, splitLines } from '../artifacts/code'

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
// Không tự biến "stag.ai" / "index.ts" thành link: chỉ link có http(s):// hoặc email.
md.linkify.set({ fuzzyLink: false })

const EXTERNAL = /^(https?:|mailto:)/i

/** Tên đuôi giả cho `highlightLines` theo ngôn ngữ của khối code (không có = chỉ escape). */
const LANG_EXT: Record<string, string> = {
  ts: 'ts', typescript: 'ts', tsx: 'tsx', js: 'js', javascript: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json', json5: 'json',
  py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh', pwsh: 'sh',
  yaml: 'yml', yml: 'yml', toml: 'toml', ini: 'ini', env: 'env', dotenv: 'env',
  sql: 'sql',
  css: 'css', scss: 'scss', less: 'less',
  go: 'go', rust: 'rs', rs: 'rs',
  java: 'java', kotlin: 'kt', kt: 'kt', swift: 'swift', c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cs: 'cs', csharp: 'cs', php: 'php', dart: 'dart', scala: 'scala'
}

const COPY_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ic shrink-0">${ICONS.copy}</svg>`

/** Mỗi dòng của khối `diff` / `patch` tô theo dấu đầu dòng. */
function highlightDiff(lines: string[]): string[] {
  return lines.map((l) => {
    const e = escapeHtml(l)
    if (/^(\+\+\+|---) /.test(l) || l.startsWith('@@')) return `<span class="text-info">${e}</span>`
    if (l.startsWith('+')) return `<span class="text-work">${e}</span>`
    if (l.startsWith('-')) return `<span class="text-danger">${e}</span>`
    return e
  })
}

/** HTML của một khối code có tiêu đề (đã escape hết nội dung). */
export function codeBlockHtml(code: string, info: string): string {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const lines = splitLines(code)
  const rows = lang === 'diff' || lang === 'patch' ? highlightDiff(lines) : highlightLines(lines, `x.${LANG_EXT[lang] ?? ''}`)
  return (
    `<div class="cc-code my-2 overflow-hidden rounded-md border border-line bg-bg0">` +
    `<div class="flex h-6 items-center gap-2 border-b border-line pr-1 pl-2.5 text-[11px] text-dim">` +
    `<span class="min-w-0 flex-1 truncate font-mono">${escapeHtml(lang)}</span>` +
    `<button type="button" data-copy class="inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[11px] text-muted hover:bg-panel-3 hover:text-fg">${COPY_SVG}<span data-copy-label>Sao chép</span></button>` +
    `</div>` +
    `<pre class="m-0! overflow-x-auto rounded-none! border-0! bg-transparent! px-2.5! py-2! font-mono text-[12px] leading-[1.5]"><code class="text-[12px]!">${rows.join('\n')}</code></pre>` +
    `</div>`
  )
}

md.renderer.rules.fence = (tokens, idx) => codeBlockHtml(tokens[idx].content, tokens[idx].info)
md.renderer.rules.code_block = (tokens, idx) => codeBlockHtml(tokens[idx].content, '')

// Link: bỏ href (không để trình duyệt tự điều hướng); chỉ http(s) / mailto mới có `data-href` để app mở.
md.renderer.rules.link_open = (tokens, idx, opts, _env, self) => {
  const t = tokens[idx]
  const href = String(t.attrGet('href') ?? '')
  t.attrs = []
  if (EXTERNAL.test(href)) {
    t.attrSet('class', 'md-ext')
    t.attrSet('data-href', href)
    t.attrSet('data-tip', href)
  } else {
    t.attrSet('class', 'md-link-other')
  }
  return self.renderToken(tokens, idx, opts)
}

// Ảnh markdown: không tải gì, chỉ hiện chữ thay thế.
md.renderer.rules.image = (tokens, idx) => `<span class="md-embed md-file">${escapeHtml(tokens[idx].content || 'ảnh')}</span>`

// Bảng rộng cuộn ngang trong khung riêng (ô chat có thể chỉ ~300px).
md.renderer.rules.table_open = () => '<div class="my-2 overflow-x-auto"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'

/** `- [ ] việc` / `- [x] việc` → hộp tick chỉ đọc (như vault/markdown.ts, bản gọn). */
function taskLists(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const m = /^\[([ xX])\](?:[ \t]|$)/.exec(inline.content)
    const first = inline.children?.[0]
    if (!m || !first || first.type !== 'text' || !first.content.startsWith(m[0])) continue
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('task_box', 'input', 0)
    box.meta = { checked: m[1] !== ' ' }
    inline.children!.unshift(box)
    tokens[i - 2].attrJoin('class', 'task')
    for (let j = i - 3; j >= 0; j--) {
      const t = tokens[j]
      if (t.nesting === 1 && t.level === tokens[i - 2].level - 1 && /_list_open$/.test(t.type)) {
        if (!t.attrGet('class')) t.attrSet('class', 'task-list')
        break
      }
    }
  }
}
md.core.ruler.push('chat_task_lists', taskLists)
md.renderer.rules.task_box = (tokens, idx) =>
  `<input type="checkbox" class="md-task" disabled${(tokens[idx].meta as { checked: boolean }).checked ? ' checked' : ''}> `

/** Con trỏ nhấp nháy cuối chữ đang stream. */
const CARET = '<span class="cc-caret ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px] animate-pulse rounded-[1px] bg-accent/80"></span>'

/** Chèn con trỏ vào cuối đoạn / mục danh sách cuối (không thì thêm sau cùng). */
export function withCaret(html: string): string {
  const m = /(<\/(?:p|li|h[1-6])>\s*(?:<\/(?:ul|ol|blockquote)>\s*)*)$/.exec(html)
  return m ? html.slice(0, m.index) + CARET + html.slice(m.index) : html + CARET
}

export function renderChatMarkdown(text: string, opts: { caret?: boolean } = {}): string {
  const html = md.render(text)
  return opts.caret ? withCaret(html) : html
}

/**
 * Kiểu chữ của tin assistant: nền `.md-body` (styles.css, ngoài @layer nên ghi đè phải có `!`), cỡ 13px,
 * tiêu đề nhỏ, khoảng cách sát. Mỗi lớp viết trọn chuỗi để Tailwind quét được.
 */
export const CHAT_PROSE = [
  'md-body',
  'text-[13px]! leading-[1.6]!',
  '[&_h1]:text-[15px]! [&_h1]:mt-3! [&_h1]:mb-1!',
  '[&_h2]:text-[14px]! [&_h2]:mt-3! [&_h2]:mb-1! [&_h2]:border-b-0! [&_h2]:pb-0!',
  '[&_h3]:text-[13px]! [&_h3]:mt-2! [&_h3]:mb-0.5!',
  '[&_h4]:text-[13px]! [&_h5]:text-[13px]! [&_h6]:text-[13px]!',
  '[&_p]:my-1.5!',
  '[&_ul]:my-1! [&_ul]:pl-5! [&_ol]:my-1! [&_ol]:pl-5!',
  '[&_li]:my-0.5',
  '[&_blockquote]:my-1.5!',
  '[&_table]:m-0! [&_table]:text-[12px]!',
  '[&_:not(pre)>code]:text-[12px]! [&_:not(pre)>code]:bg-panel-3! [&_:not(pre)>code]:px-[5px]! [&_:not(pre)>code]:py-px! [&_:not(pre)>code]:rounded-[3px]!',
  '[&>:last-child]:mb-0!'
].join(' ')
