// Gõ bằng giọng nói (V1): model, trạng thái, phím tắt, cắt đoạn âm thanh, chống lặp danh sách gợi ý.
// Dùng chung cho main (tải model, worker nhận dạng) và renderer (thu âm, phím tắt). Xem vault: Vietnamese voice input.
import type { VoiceHotkey } from './types'

export type { VoiceHotkey }

/** Tần số mẫu đưa cho máy nhận dạng (AudioContext của renderer thu thẳng ở tần số này). */
export const VOICE_RATE = 16000

/** Model nhận dạng (đã chọn qua V0: vault 2026-10-09 Voice engine Qwen3-ASR). */
export interface VoiceModel {
  id: string
  label: string
  /** Tên thư mục sau khi giải nén (= tên file nén bỏ .tar.bz2). */
  archive: string
  url: string
  /** Kích thước file nén (byte) và SHA-256 do GitHub công bố: kiểm khi tải xong. */
  bytes: number
  sha256: string
  /** File phải có trong thư mục model (tương đối, '/'). */
  files: string[]
}

export const VOICE_MODEL: VoiceModel = {
  id: 'qwen3-asr-0.6b-int8',
  label: 'Qwen3-ASR 0.6B (int8)',
  archive: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
  bytes: 878_702_423,
  sha256: '393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96',
  files: ['conv_frontend.onnx', 'encoder.int8.onnx', 'decoder.int8.onnx', 'tokenizer/vocab.json', 'tokenizer/merges.txt', 'tokenizer/tokenizer_config.json']
}

/** Trạng thái model trên đĩa + bộ nhận dạng trong RAM (main → renderer). */
export interface VoiceStatus {
  model: 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error'
  /** Đang tải: số byte đã nhận / tổng. */
  received?: number
  total?: number
  /** Lỗi tải / giải nén / nạp model. */
  error?: string
  /** Tiến trình nhận dạng: chưa chạy (không tốn RAM) / đang nạp model / sẵn sàng. */
  engine: 'off' | 'loading' | 'ready'
}

export interface VoiceResult {
  text: string
  /** Thời gian nhận dạng (ms), gồm cả lần chạy lại khi bị chép danh sách gợi ý. */
  ms: number
  /** Model chép danh sách gợi ý vào câu → đã nhận dạng lại không gợi ý. */
  echo: boolean
}

// ---------- phím tắt ----------

export const VOICE_HOTKEYS: Record<VoiceHotkey, string> = {
  'ctrl+space': 'Ctrl + Space',
  'ctrl+shift+space': 'Ctrl + Shift + Space',
  'ctrl+alt+space': 'Ctrl + Alt + Space',
  f9: 'F9'
}

interface KeyLike {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Phím vừa nhấn có phải tổ hợp nói không (đúng modifier, không thừa). */
export function isHotkeyDown(e: KeyLike, hk: VoiceHotkey): boolean {
  if (e.metaKey) return false
  if (hk === 'f9') return e.code === 'F9' && !e.ctrlKey && !e.shiftKey && !e.altKey
  const shift = hk === 'ctrl+shift+space'
  const alt = hk === 'ctrl+alt+space'
  return e.code === 'Space' && e.ctrlKey && e.shiftKey === shift && e.altKey === alt
}

/** Thả một phím của tổ hợp (Space / F9 hoặc Ctrl) = thôi nói. */
export function isHotkeyUp(e: { code: string; key: string }, hk: VoiceHotkey): boolean {
  if (hk === 'f9') return e.code === 'F9'
  return e.code === 'Space' || e.key === 'Control'
}

// ---------- cắt đoạn ----------

/**
 * Qwen3-ASR chỉ chứa ~512 token (gợi ý + âm thanh): đo 2026-10-09, 21 s vẫn đúng, 31 s cụt đuôi, 45 s ra rỗng;
 * thời gian nhận dạng tăng nhanh theo độ dài. Nên cắt thành đoạn ≤ CHUNK_MAX_S, tại chỗ ngắt hơi.
 */
export const CHUNK_MIN_S = 6
export const CHUNK_MAX_S = 12
/** Cửa sổ đo năng lượng khi tìm chỗ ngắt hơi. */
const WIN = VOICE_RATE / 20

/**
 * Tìm chỗ cắt trong `samples[from, to)`: giữa cửa sổ 50 ms yên nhất (năng lượng thấp nhất).
 * Hoà thì lấy chỗ muộn hơn (đoạn đầu dài hơn, ít đoạn hơn).
 */
export function findSplit(samples: Float32Array, from: number, to: number): number {
  from = Math.max(0, Math.floor(from))
  to = Math.min(samples.length, Math.floor(to))
  if (to - from <= WIN) return to
  let best = to
  let bestE = Infinity
  for (let s = from; s + WIN <= to; s += WIN / 2) {
    let e = 0
    for (let i = s; i < s + WIN; i++) e += samples[i] * samples[i]
    if (e <= bestE) {
      bestE = e
      best = s + WIN / 2
    }
  }
  return best
}

/**
 * Âm thanh đã thu từ `start` dài quá CHUNK_MAX_S → trả về chỗ cắt (chỗ ngắt hơi trong khoảng CHUNK_MIN_S…CHUNK_MAX_S),
 * chưa đủ dài → null. `final` (người dùng đã thả phím): phần còn lại đủ ngắn thì gửi luôn cả phần.
 */
export function nextCut(samples: Float32Array, start: number, end: number, final: boolean): number | null {
  const len = end - start
  if (len <= 0) return null
  if (len <= CHUNK_MAX_S * VOICE_RATE) return final ? end : null
  return findSplit(samples, start + CHUNK_MIN_S * VOICE_RATE, start + CHUNK_MAX_S * VOICE_RATE)
}

/**
 * Bỏ khoảng lặng ở đầu và cuối đoạn (giữ `padS` giây đệm): bớt âm thanh thì nhận dạng nhanh hơn (thời gian tăng theo độ dài).
 * Không có tiếng thì trả về đoạn rỗng.
 */
export function trimSilence(samples: Float32Array, threshold = 0.02, padS = 0.25): Float32Array {
  let first = -1
  let last = -1
  for (let i = 0; i < samples.length; i++)
    if (Math.abs(samples[i]) >= threshold) {
      if (first < 0) first = i
      last = i
    }
  if (first < 0) return samples.subarray(0, 0)
  const pad = Math.round(padS * VOICE_RATE)
  return samples.subarray(Math.max(0, first - pad), Math.min(samples.length, last + 1 + pad))
}

// ---------- gợi ý từ ----------

/** Mục gợi ý: một dòng, không có dấu phẩy (Qwen3 nhận danh sách CSV), không trùng, tối đa `max` mục. */
export function cleanHotwords(list: readonly string[], max = 40): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const t = raw.replace(/[,\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
      if (out.length >= max) break
    }
  }
  return out
}

/**
 * Qwen3 đôi khi chép nguyên danh sách gợi ý vào câu (V0: 1–2 / 16 câu). Dấu hiệu: ≥3 mục liền nhau của danh sách
 * xuất hiện liền nhau trong câu. Trả về vị trí bắt đầu đoạn chép, -1 nếu không có.
 */
export function echoAt(text: string, hotwords: readonly string[]): number {
  const h = text.toLowerCase()
  for (let i = 0; i + 2 < hotwords.length; i++) {
    const run = hotwords
      .slice(i, i + 3)
      .map((t) => t.toLowerCase())
      .join(' ')
    const at = h.indexOf(run)
    if (at >= 0) return at
  }
  return -1
}

/** Ghép kết quả các đoạn: bỏ khoảng trắng thừa. */
export function joinChunks(parts: readonly string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
}

/** Tốc độ tải để hiện "x MB / y MB". */
export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1e6).toLocaleString('vi-VN')} MB`
}
