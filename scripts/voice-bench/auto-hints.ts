// Gợi ý tự động của V2 cho bộ đo: quét một thư mục dự án như app rồi chọn danh sách gửi máy nhận dạng.
// Dùng (đóng gói bằng esbuild vì là TypeScript):
//   npx esbuild scripts/voice-bench/auto-hints.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --outfile=.voice-bench/auto-hints.mjs
//   node .voice-bench/auto-hints.mjs <thư mục dự án> <file ra .json>
// GENERAL=0: không thêm từ chung; MAX=n: số mục; CONTEXT=1: mô phỏng "từ đang hiện trong ô agent" — mỗi câu một danh sách,
// (chạy từ thư mục gốc repo) ngữ cảnh = các từ của câu đó lẫn giữa 30 từ khác của workspace (như Claude vừa nhắc tới trong terminal).
// → { hot, terms, perSentence? }: dùng với bench.mjs (HINTS_FILE=…) và post.ts (TERMS_FILE=…).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanVocab } from '../../src/main/voiceVocab'
import { contextTerms, GENERAL_TERMS, HOTWORD_MAX, pickHotwords } from '../../src/shared/voiceVocab'

const [root, out] = process.argv.slice(2)
const workspace = await scanVocab(root)
const general = process.env.GENERAL === '0' ? [] : GENERAL_TERMS
const max = Number(process.env.MAX || HOTWORD_MAX)
const hot = pickHotwords({ manual: [], agents: [], context: [], workspace, general }, max)
let perSentence: Record<string, string[]> | undefined
if (process.env.CONTEXT === '1') {
  const sentences = JSON.parse(readFileSync(join('scripts', 'voice-bench', 'sentences.json'), 'utf8')) as Array<{ id: string; terms: string[] }>
  perSentence = {}
  sentences.forEach((s, i) => {
    const noise = workspace.slice(40 + i * 30, 70 + i * 30)
    const screen = `${noise.slice(0, 15).join(' ')} ${s.terms.join(' ')} ${noise.slice(15).join(' ')}`
    perSentence![s.id] = pickHotwords({ manual: [], agents: [], context: contextTerms(screen), workspace, general }, max)
  })
}
writeFileSync(out, JSON.stringify({ hot, terms: [...workspace, ...general], perSentence }, null, 1))
console.log(`${hot.length} gợi ý / ${workspace.length} từ workspace:\n${hot.join(', ')}`)
