// Tiến trình nhận dạng giọng nói (Electron utilityProcess, xem voice.ts). Chỉ chạy khi người dùng nói;
// app tắt tiến trình này sau vài phút không dùng để trả RAM (~1,2 GB khi đã nạp Qwen3-ASR).
// Giao thức: { id, type: 'load', modelDir, threads } | { id, type: 'transcribe', samples, hotwords, language }
//          → { id, ok: true, result } | { id, ok: false, error }
import { join } from 'node:path'
import { echoAt, VOICE_RATE, type VoiceResult } from '@shared/voice'

interface Stream {
  setOption(key: string, value: string): void
  acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void
}
interface Recognizer {
  createStream(): Stream
  decode(s: Stream): void
  getResult(s: Stream): { text: string }
}

type Msg =
  | { id: number; type: 'load'; modelDir: string; threads: number }
  | { id: number; type: 'transcribe'; samples: Float32Array | number[]; hotwords: string[]; language: string }

const port = process.parentPort
let rec: Recognizer | null = null

function load(modelDir: string, threads: number): void {
  // Nạp muộn: lỗi thiếu module native báo về như lỗi của lần gọi, không làm tiến trình chết câm.
  const sherpa = require('sherpa-onnx-node') as { OfflineRecognizer: new (cfg: unknown) => Recognizer }
  rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: VOICE_RATE, featureDim: 80 },
    modelConfig: {
      qwen3Asr: {
        convFrontend: join(modelDir, 'conv_frontend.onnx'),
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        tokenizer: join(modelDir, 'tokenizer')
      },
      tokens: '',
      numThreads: threads,
      provider: 'cpu',
      debug: 0
    }
  })
}

function decode(samples: Float32Array, hotwords: string[], language: string): string {
  const s = rec!.createStream()
  // Không ép ngôn ngữ thì Qwen3 có lúc trả lời bằng tiếng Trung (V0).
  if (language) s.setOption('language', language)
  if (hotwords.length) s.setOption('hotwords', hotwords.join(','))
  s.acceptWaveform({ samples, sampleRate: VOICE_RATE })
  rec!.decode(s)
  return rec!.getResult(s).text.trim()
}

function transcribe(raw: Float32Array | number[], hotwords: string[], language: string): VoiceResult {
  // Mã lỗi: main đổi thành chữ theo ngôn ngữ giao diện (tiến trình này không biết ngôn ngữ).
  if (!rec) throw new Error('model_not_loaded')
  const samples = raw instanceof Float32Array ? raw : Float32Array.from(raw)
  const t = performance.now()
  let text = decode(samples, hotwords, language)
  let echo = false
  if (hotwords.length && echoAt(text, hotwords) >= 0) {
    echo = true
    text = decode(samples, [], language)
  }
  return { text, ms: Math.round(performance.now() - t), echo }
}

port.on('message', (e: { data: Msg }) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      if (!rec) load(m.modelDir, m.threads)
      port.postMessage({ id: m.id, ok: true, result: null })
    } else if (m.type === 'transcribe') {
      port.postMessage({ id: m.id, ok: true, result: transcribe(m.samples, m.hotwords, m.language) })
    }
  } catch (err) {
    port.postMessage({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) })
  }
})
