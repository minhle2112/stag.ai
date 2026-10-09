import { create } from 'zustand'
import { appendText, CLOUD_TERMS_MAX, joinChunks, nextCut, trimSilence, type VoiceStatus } from '@shared/voice'
import { contextTerms, GENERAL_TERMS, pickHotwords, postProcess } from '@shared/voiceVocab'
import { MicCapture } from '../voice/capture'
import { pasteIntoTerminal, terminalText } from '../terminals'
import { useAgents } from './agents'
import { useSettings } from './settings'

/**
 * Gõ bằng giọng nói — phía giao diện. Một lượt: giữ phím tắt (hoặc bấm nút micro) → thu âm → thả phím → ghép chữ →
 * khung xem trước (hoặc chèn thẳng) vào ô agent đang chọn. Không bao giờ tự nhấn Enter.
 * - Máy trên máy (V1): cắt đoạn ≤ 12 s ở chỗ ngắt hơi, gửi nhận dạng ngay trong lúc đang nói.
 * - Máy đám mây Soniox (V3): gửi âm thanh liên tục qua main, chữ hiện dần trong lúc nói; lỗi (mất mạng, key sai…) mà
 *   đã có model trên máy thì tự nhận dạng lại bằng máy trên máy từ bản ghi, không mất câu.
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
  /** Máy đám mây: chữ đã chốt / đang đoán của lượt đang nói (hiện dần). */
  live: string
  livePartial: string
  error: string
  /** Lỗi do chưa cài đặt xong (chưa tải model / chưa có API key) → khung lỗi có nút mở Cài đặt. */
  needsModel: boolean
  /** Thông báo kèm khung xem trước (vd. đám mây lỗi, đã dùng máy trên máy). */
  notice: string
  setText: (t: string) => void
}

const CLEAR = { error: '', needsModel: false, level: 0, live: '', livePartial: '', notice: '' }

export const useVoice = create<VoiceState>((set) => {
  window.stag.voice.status().then((status) => set({ status }))
  window.stag.voice.onChanged((status) => set({ status }))
  return { status: { model: 'missing', engine: 'off' }, phase: 'idle', target: null, text: '', ...CLEAR, setText: (text) => set({ text }) }
})

const mic = new MicCapture()
mic.onLevel = (peak) => {
  const s = useVoice.getState()
  if (s.phase === 'listening') useVoice.setState({ level: Math.min(1, peak * 1.6) })
}

interface Cloud {
  id: string
  /** Mở lượt nói trên Soniox (lỗi: chưa có key…). */
  started: Promise<void>
  /** Số mẫu đã gửi. */
  sent: number
}

interface Session {
  target: VoiceTarget
  /** Máy trên máy: kết quả các đoạn đã gửi, đúng thứ tự. */
  parts: Promise<string>[]
  /** Máy trên máy: mẫu đầu tiên chưa gửi. */
  start: number
  cloud: Cloud | null
  timer: ReturnType<typeof setInterval> | null
  /** Thả phím trước khi micro kịp mở. */
  released: boolean
  heard: boolean
  vocab: Promise<Vocab>
}

const VOCAB_WAIT_MS = 1500

interface Vocab {
  /** Gợi ý cho máy trên máy (Qwen3 chứa ít). */
  hot: string[]
  /** Gợi ý cho Soniox (`context.terms`, chứa được nhiều hơn). */
  cloud: string[]
  /** Mọi từ code biết được, để sửa dạng chữ sau nhận dạng. */
  terms: string[]
}
let session: Session | null = null

window.stag.voice.onCloudText((id, live, livePartial, error) => {
  const s = session
  if (s?.cloud?.id !== id) return
  if (!error) return useVoice.setState({ live, livePartial })
  // Đám mây lỗi giữa lúc nói: có model trên máy thì bật nó ngay (nạp trong lúc người dùng còn nói), không thì báo luôn.
  if (useVoice.getState().status.model !== 'ready') return fail(error, /API key/.test(error))
  void window.stag.voice.prewarm()
  useVoice.setState({ live: '', livePartial: `(${error} Thả phím xong sẽ nhận dạng bằng máy trên máy.)` })
})

function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * Từ vựng của lượt nói (tính một lần lúc bắt đầu, trong lúc mở micro). Tắt "Tự gợi ý từ" thì chỉ còn từ tự thêm + tên agent.
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
  const src = { manual: vs.hotwords, agents, context, workspace, general }
  return { hot: pickHotwords(src), cloud: pickHotwords(src, CLOUD_TERMS_MAX), terms: [...vs.hotwords, ...agents, ...context, ...workspace, ...general] }
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

/** Máy trên máy: gửi các đoạn đã đủ dài (đang nói) hoặc phần còn lại (`final`). */
function flush(s: Session, all: Float32Array, final: boolean): void {
  for (;;) {
    const cut = nextCut(all, s.start, all.length, final)
    if (cut === null || cut <= s.start) return
    send(s, all.slice(s.start, cut))
    s.start = cut
  }
}

/** Máy đám mây: gửi phần âm thanh mới (kể cả 0,3 s trước khi nhấn phím). */
function pump(c: Cloud, all: Float32Array): void {
  if (all.length <= c.sent) return
  window.stag.voice.cloudAudio(c.id, all.slice(c.sent))
  c.sent = all.length
}

function stopCloud(s: Session | null): void {
  if (s?.cloud) window.stag.voice.cloudCancel(s.cloud.id)
}

function fail(error: string, needsModel = false): void {
  if (session?.timer) clearInterval(session.timer)
  stopCloud(session)
  session = null
  mic.discard()
  mic.closeLater()
  useVoice.setState({ phase: 'error', error, needsModel, level: 0, live: '', livePartial: '' })
}

/** Bắt đầu nói vào ô `target` (đang xem trước ô này thì nói thêm, nối vào chữ cũ). */
export async function beginVoice(target: VoiceTarget): Promise<void> {
  const v = useVoice.getState()
  if (session || v.phase === 'opening' || v.phase === 'listening' || v.phase === 'processing') return
  const keepText = v.phase === 'preview' && v.target?.agentId === target.agentId ? v.text : ''
  useVoice.setState({ target, phase: 'opening', text: keepText, ...CLEAR })
  const vs = useSettings.getState().value.app.voice
  const useCloud = vs.engine === 'soniox'
  if (!useCloud && v.status.model !== 'ready') return fail('Chưa tải model nhận dạng giọng nói.', true)
  if (!useCloud) void window.stag.voice.prewarm()
  const vocab = vocabFor(target).catch(() => ({ hot: [], cloud: [], terms: [] }))
  let cloud: Cloud | null = null
  if (useCloud) {
    const id = crypto.randomUUID()
    const started = vocab.then((w) => window.stag.voice.cloudStart(id, w.cloud))
    started.catch(() => {})
    cloud = { id, started, sent: 0 }
  }
  const s: Session = { target, parts: [], start: 0, cloud, timer: null, released: false, heard: false, vocab }
  session = s
  try {
    await mic.open(vs.micId)
  } catch (e) {
    if (session === s) fail(`Không mở được micro: ${errText(e)}. Kiểm tra Windows Settings → Privacy → Microphone.`)
    return
  }
  if (session !== s) return
  mic.start()
  useVoice.setState({ phase: 'listening' })
  if (cloud) {
    const c = cloud
    // Chờ mở xong (có từ gợi ý) mới gửi; trong lúc đó âm thanh vẫn được ghi trong bộ đệm micro.
    let open = false
    void c.started.then(
      () => (open = true),
      (e) => {
        // Chưa có key / không mở được mà cũng không có model trên máy: báo ngay, khỏi nói vô ích.
        if (session === s && useVoice.getState().status.model !== 'ready') fail(errText(e), /API key/.test(errText(e)))
      }
    )
    s.timer = setInterval(() => open && pump(c, mic.samples()), 100)
  } else s.timer = setInterval(() => flush(s, mic.samples(), false), 500)
  if (s.released) void endVoice()
}

/** Máy đám mây: kết thúc lượt nói → chữ; lỗi mà có model trên máy thì nhận dạng lại bằng máy trên máy. */
async function finishCloud(s: Session, c: Cloud, all: Float32Array): Promise<string> {
  try {
    await c.started
    pump(c, all)
    return await window.stag.voice.cloudEnd(c.id)
  } catch (e) {
    const why = errText(e)
    window.stag.voice.cloudCancel(c.id)
    if (useVoice.getState().status.model !== 'ready') throw Object.assign(new Error(why), { setup: /API key/.test(why) })
    useVoice.setState({ notice: `Soniox lỗi: ${why} Đã nhận dạng bằng máy trên máy.` })
    s.start = 0
    s.parts = []
    flush(s, all, true)
    return joinChunks(await Promise.all(s.parts))
  }
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
  let text = ''
  try {
    let raw: string
    if (s.cloud) {
      s.heard = trimSilence(all).length > 0
      raw = await finishCloud(s, s.cloud, all)
    } else {
      flush(s, all, true)
      raw = joinChunks(await Promise.all(s.parts))
    }
    const vs = useSettings.getState().value.app.voice
    text = postProcess(raw, { terms: (await s.vocab).terms, rules: vs.replacements, commands: vs.commands })
  } catch (e) {
    if (session === s) {
      session = null
      fail(`Nhận dạng lỗi: ${errText(e)}`, !!(e as { setup?: boolean }).setup)
    }
    return
  }
  if (session !== s) return
  session = null
  useVoice.setState({ live: '', livePartial: '' })
  const prev = useVoice.getState().text
  if (!text.trim()) {
    // Nói thêm mà không ra chữ: giữ khung xem trước như cũ.
    if (prev) return useVoice.setState({ phase: 'preview' })
    return fail(s.heard ? 'Không nhận ra câu nào. Thử nói rõ hơn hoặc gần micro hơn.' : 'Không nghe thấy gì. Kiểm tra micro trong Cài đặt → Giọng nói.')
  }
  const merged = appendText(prev, text)
  if (useSettings.getState().value.app.voice.preview || useVoice.getState().notice) useVoice.setState({ phase: 'preview', text: merged })
  else insertVoice(merged)
}

/** Bỏ lượt đang nói / khung xem trước. */
export function cancelVoice(): void {
  if (session?.timer) clearInterval(session.timer)
  stopCloud(session)
  session = null
  mic.discard()
  mic.closeLater()
  useVoice.setState({ phase: 'idle', target: null, text: '', ...CLEAR })
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
  useVoice.setState({ phase: 'idle', target: null, text: '', ...CLEAR })
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
