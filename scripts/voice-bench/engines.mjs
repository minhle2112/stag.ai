// Các máy nhận dạng đem ra đo trong V0. Tất cả chạy qua sherpa-onnx-node (cùng runtime V1 sẽ dùng).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

/** Tìm file đầu tiên trong thư mục model khớp mẫu (tên file khác nhau giữa các bản phát hành). */
function pick(dir, re) {
  const f = readdirSync(dir).find((n) => re.test(n))
  if (!f) throw new Error(`thiếu file ${re} trong ${dir}`)
  return join(dir, f)
}
const maybe = (dir, re) => readdirSync(dir).find((n) => re.test(n))

export const ENGINES = [
  {
    id: 'zipformer-vi-30m',
    label: 'Zipformer vi 30M int8',
    archive: 'sherpa-onnx-zipformer-vi-30M-int8-2026-02-09',
    hints: 'hotwords',
    config: (d, hints) => transducer(d, hints)
  },
  {
    id: 'zipformer-vi',
    label: 'Zipformer vi int8 (70k giờ)',
    archive: 'sherpa-onnx-zipformer-vi-int8-2025-04-20',
    hints: 'hotwords',
    config: (d, hints) => transducer(d, hints)
  },
  {
    id: 'moonshine-vi',
    label: 'Moonshine base vi',
    archive: 'sherpa-onnx-moonshine-base-vi-quantized-2026-02-27',
    hints: null,
    config: (d) => {
      const m = {}
      // Bản 2026 dùng .ort (ONNX Runtime format) + decoder gộp; bản cũ dùng .onnx tách 4 file.
      if (maybe(d, /preprocess/)) m.preprocessor = pick(d, /preprocess.*\.(onnx|ort)$/)
      m.encoder = pick(d, /encode.*\.(onnx|ort)$/)
      if (maybe(d, /merged/)) m.mergedDecoder = pick(d, /merged.*\.(onnx|ort)$/)
      else {
        m.uncachedDecoder = pick(d, /uncached.*\.(onnx|ort)$/)
        m.cachedDecoder = pick(d, /^cached.*\.(onnx|ort)$/)
      }
      return { modelConfig: { moonshine: m, tokens: pick(d, /tokens\.txt$/) } }
    }
  },
  {
    id: 'whisper-turbo',
    label: 'Whisper large-v3-turbo int8',
    archive: 'sherpa-onnx-whisper-turbo',
    hints: null,
    config: (d) => ({
      modelConfig: {
        whisper: { encoder: pick(d, /encoder\.int8\.onnx$/), decoder: pick(d, /decoder\.int8\.onnx$/), language: 'vi', task: 'transcribe', tailPaddings: Number(process.env.WHISPER_TAIL || -1) },
        tokens: pick(d, /tokens\.txt$/)
      }
    })
  },
  {
    id: 'qwen3-asr',
    label: 'Qwen3-ASR 0.6B int8',
    archive: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
    hints: 'qwen',
    // Không ép ngôn ngữ thì có câu ra tiếng Trung.
    stream: { language: process.env.QWEN_LANG ?? 'Vietnamese' },
    // Gợi ý đặt theo từng lượt (stream option "hotwords", CSV) → đổi danh sách không cần nạp lại model.
    config: (d) => {
      const q = {
        convFrontend: pick(d, /conv.*\.onnx$/),
        encoder: pick(d, /encoder.*\.onnx$/),
        decoder: pick(d, /decoder.*\.onnx$/),
        tokenizer: existsSync(join(d, 'tokenizer')) ? join(d, 'tokenizer') : d
      }
      return { modelConfig: { qwen3Asr: q, tokens: maybe(d, /tokens\.txt$/) ? pick(d, /tokens\.txt$/) : '' } }
    }
  }
]

/**
 * sherpa cần `bpe.vocab` (dòng "piece\tscore") để mã hoá hotword; model chỉ kèm `bpe.model` (protobuf của
 * sentencepiece) → tự đọc: ModelProto.pieces (field 1) = SentencePiece { piece: 1 string, score: 2 float }.
 */
export function ensureBpeVocab(d) {
  const out = join(d, 'bpe.vocab')
  if (existsSync(out) || !existsSync(join(d, 'bpe.model'))) return existsSync(out) ? out : null
  const b = readFileSync(join(d, 'bpe.model'))
  let p = 0
  const varint = () => {
    let r = 0, s = 0, x
    do { x = b[p++]; r += (x & 0x7f) * 2 ** s; s += 7 } while (x & 0x80)
    return r
  }
  const lines = []
  while (p < b.length) {
    const key = varint(), field = key >> 3, wire = key & 7
    if (wire === 2) {
      const len = varint(), end = p + len
      if (field === 1) {
        let piece = '', score = 0
        while (p < end) {
          const k = varint(), f = k >> 3, w = k & 7
          if (w === 2) { const l = varint(); if (f === 1) piece = b.toString('utf8', p, p + l); p += l }
          else if (w === 5) { if (f === 2) score = b.readFloatLE(p); p += 4 }
          else if (w === 0) varint()
          else if (w === 1) p += 8
        }
        lines.push(`${piece}\t${score}`)
      }
      p = end
    } else if (wire === 0) varint()
    else if (wire === 5) p += 4
    else if (wire === 1) p += 8
    else break
  }
  writeFileSync(out, lines.join('\n') + '\n')
  return out
}

function transducer(d, hints) {
  const cfg = {
    modelConfig: {
      transducer: { encoder: pick(d, /encoder.*\.onnx$/), decoder: pick(d, /decoder.*\.onnx$/), joiner: pick(d, /joiner.*\.onnx$/) },
      tokens: pick(d, /tokens\.txt$/)
    },
    decodingMethod: 'greedy_search'
  }
  if (hints) {
    cfg.decodingMethod = 'modified_beam_search'
    cfg.maxActivePaths = 4
    const vocab = ensureBpeVocab(d)
    if (vocab) {
      cfg.modelConfig.modelingUnit = 'bpe'
      cfg.modelConfig.bpeVocab = vocab
    }
  }
  return cfg
}

export const url = (e) => `${REL}/${e.archive}.tar.bz2`
