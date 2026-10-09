// Sửa chữ sau nhận dạng như app (V2) cho bộ đo: POST_MODULE=.voice-bench/post.mjs TERMS_FILE=<json của auto-hints> node bench.mjs
//   npx esbuild scripts/voice-bench/post.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --outfile=.voice-bench/post.mjs
// Như app: từ dùng để sửa = gợi ý đã gửi cho câu đó (gồm từ đang hiện trong ô) + toàn bộ từ vựng workspace + từ chung.
import { readFileSync } from 'node:fs'
import { postProcess } from '../../src/shared/voiceVocab'

const file = process.env.TERMS_FILE
const data = file ? (JSON.parse(readFileSync(file, 'utf8')) as { terms: string[]; perSentence?: Record<string, string[]> }) : { terms: [] }

export function post(text: string, id?: string): string {
  const terms = [...((id && data.perSentence?.[id]) || []), ...data.terms]
  return postProcess(text, { terms, rules: [], commands: false })
}
