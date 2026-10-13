import { useEffect, useRef, useState } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, MatchDecorator, placeholder, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { VaultNoteInfo } from '@shared/types'
import { Button } from '../Modal'
import { syncAction, wikilinkQuery } from './editSync'

/** Ngừng gõ chừng này thì tự lưu (Obsidian cũng tự lưu). */
const AUTOSAVE_MS = 800

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** Trạng thái lưu báo lên thanh đầu của Vault (null = trình soạn đã đóng). */
export interface EditorStatus {
  state: SaveState
  error: string | null
  /** Đang chờ người dùng chọn bản nào khi file bị sửa chồng. */
  conflict: boolean
}

interface Props {
  vaultPath: string
  rel: string
  /** Nội dung trên đĩa (đọc lại mỗi khi vault đổi); null = file không còn. */
  disk: string | null
  notes: VaultNoteInfo[] | null
  onStatus?: (s: EditorStatus | null) => void
}

/** Màu cú pháp markdown theo bảng màu của app (bản "Xưởng": tiêu đề sáng + đậm, link teal, code xanh lá nhạt). */
export const noteHighlight = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: 'var(--color-fg)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--color-fg)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--color-accent)' },
  { tag: tags.monospace, color: 'var(--color-code-str)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.quote], color: 'var(--color-dim)' },
  // Frontmatter YAML (Obsidian: Properties).
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-dim)' }
])

export const noteTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-muted)', fontSize: '13px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', overflow: 'auto' },
    '.cm-content': { padding: '24px 40px 40vh', caretColor: 'var(--color-accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-fg) 3%, transparent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent) !important' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' },
    // [[wikilink]] và frontmatter (decorations bên dưới).
    '.cm-wikilink': { color: 'var(--color-accent)' },
    '.cm-fm, .cm-fm span': { color: 'var(--color-dim)' },
    '.cm-panels': { backgroundColor: 'var(--color-bg0)', color: 'var(--color-muted)', borderColor: 'var(--color-line)' },
    '.cm-panel.cm-search': { fontFamily: 'var(--font-sans)', fontSize: '12px' },
    '.cm-panels input, .cm-panels button': { fontSize: '12px' },
    '.cm-textfield': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-fg)',
      border: '1px solid var(--color-line-2)',
      borderRadius: '4px',
      padding: '2px 6px',
      outline: 'none'
    },
    '.cm-textfield:focus': { borderColor: 'color-mix(in srgb, var(--color-accent) 42%, transparent)' },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--color-panel-2)',
      color: 'var(--color-fg)',
      border: '1px solid var(--color-line-2)',
      borderRadius: '4px',
      padding: '1px 8px'
    },
    '.cm-button:hover': { backgroundColor: 'var(--color-panel-3)' },
    '.cm-tooltip': { backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-line-2)', borderRadius: '6px', overflow: 'hidden' },
    '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--font-sans)', fontSize: '12px' },
    '.cm-tooltip-autocomplete ul li': { padding: '2px 8px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-panel-3)', color: 'var(--color-fg)' },
    '.cm-completionDetail': { color: 'var(--color-dim)' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--color-accent)' },
    '.cm-placeholder': { color: 'var(--color-dim)' }
  },
  { dark: true }
)

/** `[[link]]` tô teal (CodeMirror không tự nhận cú pháp wikilink của Obsidian). */
const wikilinkMatcher = new MatchDecorator({ regexp: /\[\[[^\]\n]+\]\]/g, decoration: Decoration.mark({ class: 'cm-wikilink' }) })
const wikilinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = wikilinkMatcher.createDeco(view)
    }
    update(u: ViewUpdate): void {
      this.decorations = wikilinkMatcher.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/** Frontmatter `---…---` ở đầu note: mờ cả khối (giống Obsidian Source mode). */
const fmLine = Decoration.line({ class: 'cm-fm' })
const FENCE = /^---\s*$/
function frontmatterLines(state: EditorState): DecorationSet {
  const doc = state.doc
  if (doc.lines < 2 || !FENCE.test(doc.line(1).text)) return Decoration.none
  for (let end = 2; end <= doc.lines; end++) {
    if (!FENCE.test(doc.line(end).text)) continue
    const ranges = []
    for (let n = 1; n <= end; n++) ranges.push(fmLine.range(doc.line(n).from))
    return Decoration.set(ranges)
  }
  return Decoration.none
}
const frontmatterTint: Extension = StateField.define<DecorationSet>({
  create: frontmatterLines,
  update: (value, tr) => (tr.docChanged ? frontmatterLines(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f)
})

/**
 * Trình soạn note (CodeMirror 6, markdown thô như chế độ Source của Obsidian). Tự lưu sau khi ngừng gõ,
 * Ctrl+S lưu ngay, rời note thì lưu nốt. Ai đó sửa file cùng lúc → không ghi đè, hỏi người dùng (editSync.ts).
 * Trạng thái lưu báo lên qua `onStatus` (hiện ở thanh đầu của Vault); ở đây chỉ còn thanh xung đột / lỗi.
 */
export function NoteEditor({ vaultPath, rel, disk, notes, onStatus }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  /** Nội dung coi như đang có trên đĩa: lần đọc / lưu gần nhất. */
  const base = useRef(disk ?? '')
  /** Chữ đang được ghi (lần đọc lại tới trước khi ghi xong thì không phải sửa bên ngoài). */
  const inflight = useRef<string | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  /** Bản trên đĩa khi bị sửa chồng (null = file đã bị xoá); khác undefined = đang chờ người dùng chọn. */
  const [conflict, setConflict] = useState<{ disk: string | null } | undefined>(undefined)
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict

  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  useEffect(() => {
    onStatusRef.current?.({ state, error, conflict: !!conflict })
  }, [state, error, conflict])
  useEffect(() => () => onStatusRef.current?.(null), [])

  const text = (): string => view.current?.state.doc.toString() ?? base.current

  async function save(force = false): Promise<void> {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (conflictRef.current && !force) return
    const now = text()
    if (now === base.current && !force) {
      setState('saved')
      return
    }
    setState('saving')
    inflight.current = now
    try {
      const r = await window.stag.vault.write(vaultPath, rel, now, force ? (conflictRef.current?.disk ?? null) : base.current)
      if (r.status === 'conflict') {
        setConflict({ disk: r.disk })
        setState('dirty')
        return
      }
      base.current = now
      setConflict(undefined)
      setError(null)
      // Người dùng gõ tiếp trong lúc đang lưu → còn phải lưu nữa.
      if (text() !== now) schedule()
      else setState('saved')
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setState('error')
    } finally {
      inflight.current = null
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  function schedule(): void {
    if (timer.current) clearTimeout(timer.current)
    setState('dirty')
    timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_MS)
  }
  const scheduleRef = useRef(schedule)
  scheduleRef.current = schedule

  function replaceDoc(next: string): void {
    const v = view.current
    if (!v) return
    const head = Math.min(v.state.selection.main.head, next.length)
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next }, selection: { anchor: head } })
  }

  // Tạo trình soạn một lần cho mỗi note (component được gắn key theo note).
  useEffect(() => {
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const line = ctx.state.doc.lineAt(ctx.pos)
      const q = wikilinkQuery(line.text.slice(0, ctx.pos - line.from))
      if (q === null || !notesRef.current) return null
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2)
      return {
        from: ctx.pos - q.length,
        options: notesRef.current.map((n) => ({
          label: n.name,
          detail: n.rel.includes('/') ? n.rel.slice(0, n.rel.lastIndexOf('/')) : undefined,
          apply: after === ']]' ? n.name : `${n.name}]]`
        })),
        validFor: /^[^\]|#\n]*$/
      }
    }
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: disk ?? '',
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          closeBrackets(),
          search({ top: true }),
          highlightSelectionMatches(),
          autocompletion({ override: [complete], icons: false }),
          // Frontmatter `---…---` đầu note là YAML, không phải tiêu đề setext của markdown.
          yamlFrontmatter({ content: markdown() }),
          syntaxHighlighting(noteHighlight),
          wikilinks,
          frontmatterTint,
          EditorView.lineWrapping,
          placeholder('Note trống…'),
          noteTheme,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(), true) },
            indentWithTab,
            ...closeBracketsKeymap,
            // Ctrl+G là "Đồ thị" của Vault (F3 vẫn là tìm tiếp).
            ...searchKeymap.filter((k) => k.key !== 'Mod-g'),
            ...historyKeymap,
            ...defaultKeymap
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('undo') || t.isUserEvent('redo') || t.isUserEvent('move')))
              scheduleRef.current()
          })
        ]
      })
    })
    view.current = v
    v.focus()
    return () => {
      // Rời note / đổi chế độ: lưu nốt phần chưa lưu (trừ khi đang có xung đột chờ chọn).
      if (v.state.doc.toString() !== base.current && !conflictRef.current)
        void window.stag.vault.write(vaultPath, rel, v.state.doc.toString(), base.current)
      if (timer.current) clearTimeout(timer.current)
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // File trên đĩa đổi (Obsidian, agent, hoặc chính lần lưu của mình).
  useEffect(() => {
    if (!view.current || (disk !== null && disk === inflight.current)) return
    switch (syncAction(disk, base.current, text())) {
      case 'same':
        return
      case 'adopt':
        base.current = disk!
        setConflict(undefined)
        setState('saved')
        return
      case 'reload':
        base.current = disk!
        replaceDoc(disk!)
        return
      case 'conflict':
        if (timer.current) clearTimeout(timer.current)
        setConflict({ disk })
    }
  }, [disk])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-wait/40 bg-wait/10 px-4 py-2 text-[12px] text-wait">
          <span className="min-w-0 flex-1">
            {conflict.disk === null
              ? 'Note vừa bị xoá hoặc đổi tên bên ngoài (agent hoặc chương trình khác) trong lúc bạn sửa.'
              : 'Note vừa bị sửa bên ngoài (agent hoặc chương trình khác) trong lúc bạn đang sửa. Chưa ghi gì đè lên nhau.'}
          </span>
          {conflict.disk !== null && (
            <Button
              small
              onClick={() => {
                base.current = conflict.disk!
                replaceDoc(conflict.disk!)
                setConflict(undefined)
                setState('saved')
              }}
            >
              Lấy bản bên ngoài (bỏ chữ của tôi)
            </Button>
          )}
          <Button small onClick={() => void save(true)}>
            {conflict.disk === null ? 'Ghi lại bản của tôi' : 'Giữ bản của tôi (ghi đè)'}
          </Button>
        </div>
      )}
      {state === 'error' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          <span className="min-w-0 flex-1 break-words">Không lưu được{error ? `: ${error}` : ''}</span>
          <Button small onClick={() => void save()}>
            Lưu lại
          </Button>
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 select-text" />
    </div>
  )
}
