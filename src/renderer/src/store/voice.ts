import { create } from 'zustand'
import { appendText, joinChunks, nextCut, trimSilence, type VoiceStatus } from '@shared/voice'
import { contextTerms, GENERAL_TERMS, pickHotwords, postProcess } from '@shared/voiceVocab'
import { MicCapture } from '../voice/capture'
import { pasteIntoTerminal, terminalText } from '../terminals'
import { useAgents } from './agents'
import { useSettings } from './settings'

/**
 * Gõ bằng giọng nói (V1) — phía giao diện. Một lượt: giữ phím tắt (hoặc bấm nút micro) → thu âm → cắt đoạn ≤ 12 s
 * ở chỗ ngắt hơi và gửi nhận dạng ngay trong lúc đang nói → thả phím → ghép chữ → khung xem trước (hoặc chèn thẳng)
 * vào ô agent đang chọn. Không bao giờ tự nhấn Enter.
 */
export type VoicePhase = 'idle' | 'opening' | 'listening' | 'processing' | 'preview' | 'error'

export interface VoiceTarget {
  wsId: string
  agentId: string
}

interface VoiceState {
  /** Model / tiến trình nhận dạng (từ main). */
  status: VoiceStatus
  phase: VoicePhase
  target: VoiceTarget | null
  /** Mức âm lượng 0…1 khi đang nghe. */
  level: number
  /** Chữ trong khung xem trước (nói thêm thì nối vào). */
  text: string
  error: string
  /** Lỗi do chưa tải model → khung lỗi có nút mở Cài đặt. */
  needsModel: boolean
  setText: (t: string) => void
}

export const useVoice = create<VoiceState>((set) => {
  window.stag.voice.status().then((status) => set({ status }))
  window.stag.voice.onChanged((status) => set({ status }))
  return {
    status: { model: 'missing', engine: 'off' },
    phase: 'idle',
    target: null,
    level: 0,
    text: '',
    error: '',
    needsModel: false,
    setText: (text) => set({ text })
  }
})

const mic = new MicCapture()
mic.onLevel = (peak) => {
  const s = useVoice.getState()
  if (s.phase === 'listening') useVoice.setState({ level: Math.min(1, peak * 1.6) })
}

interface Session {
  target: VoiceTarget
  /** Kết quả các đoạn đã gửi, đúng thứ tự. */
  parts: Promise<string>[]
  /** Mẫu đầu tiên chưa gửi. */
  start: number
  timer: ReturnType<typeof setInterval> | null
  /** Thả phím trước khi micro kịp mở. */
  released: boolean
  heard: boolean
  vocab: Promise<Vocab>
}

const VOCAB_WAIT_MS = 1500

interface Vocab {
  hot: string[]
  terms: string[]
}
let session: Session | null = null

function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * Từ vựng của lượt nói (tính một lần lúc bắt đầu, trong lúc mở micro): `hot` = gợi ý gửi cho máy nhận dạng (có giới hạn),
 * `terms` = mọi từ code biết được, để sửa dạng chữ sau khi nhận dạng. Tắt "Tự gợi ý từ" thì chỉ còn từ tự thêm + tên agent.
 */
async function vocabFor(target: VoiceTarget): Promise<Vocab> {
  const vs = useSettings.getState().value.app.voice
  const agents = (useAgents.getState().byWs[target.wsId]?.agents ?? []).map((a) => a.name)
  const auto = vs.workspaceVocab
  const context = auto ? contextTerms(terminalText(target.agentId)) : []
  // Lần quét đầu của repo lớn có thể lâu: không bắt lượt nói chờ quá VOCAB_WAIT_MS (lần sau đã có sẵn).
  const workspace = auto
    ? await Promise.race([
        window.stag.voice.vocab(target.wsId).catch(() => [] as string[]),
        new Promise<string[]>((r) => setTimeout(() => r([]), VOCAB_WAIT_MS))
      ])
    : []
  const general = auto ? GENERAL_TERMS : []
  return {
    hot: pickHotwords({ manual: vs.hotwords, agents, context, workspace, general }),
    terms: [...vs.hotwords, ...agents, ...context, ...workspace, ...general]
  }
}

function send(s: Session, raw: Float32Array): void {
  // Bỏ khoảng lặng đầu / cuối: im lặng hoàn toàn thì khỏi nhận dạng, còn lại thì ngắn hơn → nhanh hơn.
  const chunk = trimSilence(raw)
  if (!chunk.length) {
    s.parts.push(Promise.resolve(''))
    return
  }
  s.heard = true
  const samples = chunk.slice()
  s.parts.push(s.vocab.then((v) => window.stag.voice.transcribe(samples, v.hot)).then((r) => r.text))
}

/** Gửi các đoạn đã đủ dài (đang nói) hoặc phần còn lại (`final`). */
function flush(s: Session, all: Float32Array, final: boolean): void {
  for (;;) {
    const cut = nextCut(all, s.start, all.length, final)
    if (cut === null || cut <= s.start) return
    send(s, all.slice(s.start, cut))
    s.start = cut
  }
}

function fail(error: string, needsModel = false): void {
  if (session?.timer) clearInterval(session.timer)
  session = null
  mic.discard()
  mic.closeLater()
  useVoice.setState({ phase: 'error', error, needsModel, level: 0 })
}

/** Bắt đầu nói vào ô `target` (đang xem trước ô này thì nói thêm, nối vào chữ cũ). */
export async function beginVoice(target: VoiceTarget): Promise<void> {
  const v = useVoice.getState()
  if (session || v.phase === 'opening' || v.phase === 'listening' || v.phase === 'processing') return
  const keepText = v.phase === 'preview' && v.target?.agentId === target.agentId ? v.text : ''
  useVoice.setState({ target, phase: 'opening', text: keepText, error: '', needsModel: false, level: 0 })
  if (v.status.model !== 'ready') return fail('Chưa tải model nhận dạng giọng nói.', true)
  void window.stag.voice.prewarm()
  const s: Session = { target, parts: [], start: 0, timer: null, released: false, heard: false, vocab: vocabFor(target).catch(() => ({ hot: [], terms: [] })) }
  session = s
  try {
    await mic.open(useSettings.getState().value.app.voice.micId)
  } catch (e) {
    if (session === s) fail(`Không mở được micro: ${errText(e)}. Kiểm tra Windows Settings → Privacy → Microphone.`)
    return
  }
  if (session !== s) return
  mic.start()
  useVoice.setState({ phase: 'listening' })
  s.timer = setInterval(() => flush(s, mic.samples(), false), 500)
  if (s.released) void endVoice()
}

/** Thả phím / bấm nút lần nữa: thu thêm POST_MS rồi nhận dạng phần còn lại. */
export async function endVoice(): Promise<void> {
  const s = session
  if (!s) return
  if (useVoice.getState().phase === 'opening') {
    s.released = true
    return
  }
  if (s.timer) clearInterval(s.timer)
  s.timer = null
  useVoice.setState({ phase: 'processing', level: 0 })
  const all = await mic.stop()
  mic.closeLater()
  flush(s, all, true)
  let text = ''
  try {
    const vs = useSettings.getState().value.app.voice
    text = postProcess(joinChunks(await Promise.all(s.parts)), { terms: (await s.vocab).terms, rules: vs.replacements, commands: vs.commands })
  } catch (e) {
    if (session === s) fail(`Nhận dạng lỗi: ${errText(e)}`)
    return
  }
  if (session !== s) return
  session = null
  const prev = useVoice.getState().text
  if (!text.trim()) {
    // Nói thêm mà không ra chữ: giữ khung xem trước như cũ.
    if (prev) return useVoice.setState({ phase: 'preview' })
    return fail(s.heard ? 'Không nhận ra câu nào. Thử nói rõ hơn hoặc gần micro hơn.' : 'Không nghe thấy gì. Kiểm tra micro trong Cài đặt → Giọng nói.')
  }
  const merged = appendText(prev, text)
  if (useSettings.getState().value.app.voice.preview) useVoice.setState({ phase: 'preview', text: merged })
  else insertVoice(merged)
}

/** Bỏ lượt đang nói / khung xem trước. */
export function cancelVoice(): void {
  if (session?.timer) clearInterval(session.timer)
  session = null
  mic.discard()
  mic.closeLater()
  useVoice.setState({ phase: 'idle', target: null, text: '', error: '', needsModel: false, level: 0 })
}

/** Chèn chữ vào ô agent (như dán: chương trình đang bật bracketed paste thì không bị gửi giữa chừng). */
export function insertVoice(text = useVoice.getState().text): void {
  const target = useVoice.getState().target
  const t = text.trim()
  if (!target || !t) return cancelVoice()
  if (!pasteIntoTerminal(target.agentId, t)) {
    useVoice.setState({ phase: 'error', error: 'Ô này không có phiên đang chạy nên chưa chèn được. Mở phiên rồi thử lại.', text: t })
    return
  }
  useVoice.setState({ phase: 'idle', target: null, text: '', error: '', needsModel: false, level: 0 })
}

/** Ô đang nhận giọng nói (để ô hiện khung). */
export function useVoiceFor(agentId: string): boolean {
  return useVoice((s) => s.phase !== 'idle' && s.target?.agentId === agentId)
}

/** Ô đích của phím tắt: ô agent đang chọn của workspace đang mở (null = không có). */
export function voiceTargetFor(wsId: string | undefined): VoiceTarget | null {
  if (!wsId) return null
  const w = useAgents.getState().byWs[wsId]
  const id = w?.focused
  if (!id || !w.agents.some((a) => a.id === id)) return null
  return { wsId, agentId: id }
}
