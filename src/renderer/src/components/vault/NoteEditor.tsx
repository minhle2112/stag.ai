import { useEffect, useRef, useState } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { VaultNoteInfo } from '@shared/types'
import { syncAction, wikilinkQuery } from './editSync'

/** Ngừng gõ chừng này thì tự lưu (Obsidian cũng tự lưu). */
const AUTOSAVE_MS = 800

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface Props {
  vaultPath: string
  rel: string
  /** Nội dung trên đĩa (đọc lại mỗi khi vault đổi); null = file không còn. */
  disk: string | null
  notes: VaultNoteInfo[] | null
}

/** Màu cú pháp markdown theo bảng màu của app. */
export const noteHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.45em', fontWeight: '600' },
  { tag: tags.heading2, fontSize: '1.25em', fontWeight: '600' },
  { tag: tags.heading3, fontSize: '1.1em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--color-accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: '#e5c07b' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--color-muted)' },
  { tag: tags.quote, color: '#a8b1c4' },
  // Frontmatter YAML (Obsidian: Properties).
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: '#8fb4ff' },
  { tag: [tags.string, tags.content], color: 'var(--color-fg)' }
])

export const noteTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-fg)', fontSize: '14px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.65', overflow: 'auto' },
    '.cm-content': { maxWidth: '48rem', margin: '0 auto', padding: '16px 24px 40vh', caretColor: 'var(--color-fg)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-fg)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(110,168,254,0.28) !important' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(110,168,254,0.15)' },
    '.cm-panels': { backgroundColor: 'var(--color-panel)', color: 'var(--color-fg)', borderColor: 'var(--color-line)' },
    '.cm-panels input, .cm-panels button': { fontSize: '12px' },
    '.cm-tooltip': { backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-line)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-panel-2)', color: 'var(--color-fg)' },
    '.cm-placeholder': { color: 'var(--color-muted)' }
  },
  { dark: true }
)

/**
 * Trình soạn note (CodeMirror 6, markdown thô như chế độ Source của Obsidian). Tự lưu sau khi ngừng gõ,
 * Ctrl+S lưu ngay, rời note thì lưu nốt. Ai đó sửa file cùng lúc → không ghi đè, hỏi người dùng (editSync.ts).
 */
export function NoteEditor({ vaultPath, rel, disk, notes }: Props): React.JSX.Element {
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
          EditorView.lineWrapping,
          placeholder('Note trống…'),
          noteTheme,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(), true) },
            indentWithTab,
            ...closeBracketsKeymap,
            ...searchKeymap,
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-200">
          <span className="flex-1">
            {conflict.disk === null
              ? 'Note vừa bị xoá hoặc đổi tên bên ngoài (Obsidian hoặc agent) trong lúc bạn sửa.'
              : 'Note vừa bị sửa bên ngoài (Obsidian hoặc agent) trong lúc bạn đang sửa. Chưa ghi gì đè lên nhau.'}
          </span>
          {conflict.disk !== null && (
            <button
              className="rounded border border-line bg-panel px-2 py-0.5 text-fg hover:border-accent"
              onClick={() => {
                base.current = conflict.disk!
                replaceDoc(conflict.disk!)
                setConflict(undefined)
                setState('saved')
              }}
            >
              Lấy bản bên ngoài (bỏ chữ của tôi)
            </button>
          )}
          <button className="rounded border border-line bg-panel px-2 py-0.5 text-fg hover:border-accent" onClick={() => void save(true)}>
            {conflict.disk === null ? 'Ghi lại bản của tôi' : 'Giữ bản của tôi (ghi đè)'}
          </button>
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 select-text" />
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-1 text-[11px] text-muted">
        <span className="font-mono">{rel}</span>
        <div className="flex-1" />
        {error && <span className="text-red-300">Không lưu được: {error}</span>}
        <span className={state === 'error' ? 'text-red-300' : state === 'saved' ? '' : 'text-amber-300'}>
          {{ saved: 'Đã lưu', dirty: conflict ? 'Chưa lưu (đang chờ bạn chọn)' : 'Chưa lưu…', saving: 'Đang lưu…', error: 'Lỗi lưu' }[state]}
        </span>
        <span>· Ctrl+S lưu · gõ [[ để chèn link</span>
      </div>
    </div>
  )
}
