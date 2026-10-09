// Đo các máy nhận dạng trên bản ghi âm của người dùng.
// Dùng: node scripts/voice-bench/bench.mjs [id...]   → .voice-bench/results/<giờ>.{json,md}
// Mỗi máy (có / không gợi ý từ) chạy trong một tiến trình con riêng để đo RAM sạch và không kéo sập cả lượt đo.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ENGINES } from './engines.mjs'

const root = resolve(import.meta.dirname, '..', '..')
const bench = join(root, '.voice-bench')
const recDir = process.env.VOICE_BENCH_REC || join(bench, 'recordings')
const modelDir = join(bench, 'models')
const sentences = JSON.parse(readFileSync(join(import.meta.dirname, 'sentences.json'), 'utf8'))
const THREADS = Number(process.env.THREADS || 4)

/**
 * Bảng từ của "workspace": mọi thuật ngữ trong bộ câu + vài tên khác của dự án (để gợi ý không quá dễ).
 * HINTS_FILE=<json>: dùng danh sách khác (vd. gợi ý tự động của V2 — xem auto-hints.ts), dạng [..] hoặc { hot: [..] }.
 */
const hintsFile = process.env.HINTS_FILE ? JSON.parse(readFileSync(process.env.HINTS_FILE, 'utf8')) : null
const GLOSSARY_ALL = hintsFile
  ? (Array.isArray(hintsFile) ? hintsFile : hintsFile.hot)
  : [
      ...new Set([
        ...sentences.flatMap((s) => s.terms),
        'Kanban', 'BrowserPane', 'AgentGrid', 'vitest', 'Obsidian', 'TypeScript', 'node-pty', 'xterm', 'ipcMain', 'artifact'
      ])
    ]
// POST_MODULE=<mjs>: sửa chữ sau nhận dạng như app (export post(text)), chấm trên chữ đã sửa; giữ chữ gốc ở `raw`.
// HINTS_FILE có `perSentence: { s01: [..] }` → mỗi câu một danh sách (mô phỏng từ đang hiện trong ô agent).
const hintsFor = (id) => hintsFile?.perSentence?.[id] ?? GLOSSARY
const post = process.env.POST_MODULE ? (await import(pathToFileURL(resolve(process.env.POST_MODULE)).href)).post : (t) => t
// HINT_LIMIT: chỉ giữ N mục đầu (thử xem danh sách ngắn có bớt lỗi chép danh sách vào câu không).
const GLOSSARY = process.env.HINT_LIMIT ? GLOSSARY_ALL.slice(0, Number(process.env.HINT_LIMIT)) : GLOSSARY_ALL

/**
 * Qwen3 đôi khi chép nguyên danh sách gợi ý vào câu. Dấu hiệu: ≥3 mục liền nhau của danh sách xuất hiện
 * liền nhau trong câu. Trả về vị trí bắt đầu đoạn chép (-1 nếu không có).
 */
export function echoAt(hyp, glossary) {
  const h = hyp.toLowerCase()
  for (let i = 0; i + 2 < glossary.length; i++) {
    const run = glossary.slice(i, i + 3).map((t) => t.toLowerCase()).join(' ')
    const at = h.indexOf(run)
    if (at >= 0) return at
  }
  return -1
}

// ---------- chấm điểm ----------
const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const squash = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export function score(ref, hyp, terms) {
  const r = norm(ref).split(' ').filter(Boolean)
  const h = norm(hyp).split(' ').filter(Boolean)
  const rc = [...squash(ref)]
  const hc = [...squash(hyp)]
  const hs = squash(hyp)
  return {
    wordErr: edits(r, h),
    words: r.length,
    charErr: edits(rc, hc),
    chars: rc.length,
    termsHit: terms.filter((t) => hs.includes(squash(t))).length,
    terms: terms.length
  }
}

/** "handleClick" → "handle click", "App.tsx" → "app tsx": dạng chữ mà model nói ra. */
const spoken = (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()

// ---------- tiến trình con: chạy một máy ----------
async function runOne(id, withHints) {
  const require = createRequire(import.meta.url)
  const sherpa = require(join(bench, 'node_modules', 'sherpa-onnx-node'))
  const e = ENGINES.find((x) => x.id === id)
  const dir = join(modelDir, e.archive)
  const hints = withHints ? GLOSSARY : null
  const cfg = e.config(dir, hints)
  cfg.featConfig = { sampleRate: 16000, featureDim: 80 }
  cfg.modelConfig.numThreads = THREADS
  cfg.modelConfig.provider = 'cpu'
  cfg.modelConfig.debug = 0
  if (withHints && e.hints === 'hotwords') cfg.hotwordsScore = 2.0
  const rss0 = process.memoryUsage().rss
  const t0 = performance.now()
  const rec = new sherpa.OfflineRecognizer(cfg)
  const loadMs = performance.now() - t0
  const hotwords = withHints && e.hints === 'hotwords' ? GLOSSARY.map((t) => spoken(t).toUpperCase()).join('/') : undefined

  const decode = (file, noHints = false, list = hints) => {
    const wave = sherpa.readWave(file)
    const stream = hotwords && !noHints ? rec.createStream(hotwords) : rec.createStream()
    for (const [k, v] of Object.entries(e.stream ?? {})) if (v) stream.setOption(k, v)
    if (list && !noHints && e.hints === 'qwen') stream.setOption('hotwords', list.join(','))
    stream.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate })
    const t = performance.now()
    rec.decode(stream)
    return { text: rec.getResult(stream).text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim(), ms: performance.now() - t, sec: wave.samples.length / wave.sampleRate }
  }

  const files = sentences.filter((s) => existsSync(join(recDir, `${s.id}.wav`)))
  if (files.length) decode(join(recDir, `${files[0].id}.wav`)) // làm nóng
  const rows = []
  for (const s of files) {
    const ref = existsSync(join(recDir, `${s.id}.txt`)) ? readFileSync(join(recDir, `${s.id}.txt`), 'utf8').trim() : s.text
    const list = hints ? hintsFor(s.id) : null
    let r = decode(join(recDir, `${s.id}.wav`), false, list)
    let echo = false
    // ECHO_GUARD=1: phát hiện chép danh sách → nhận dạng lại không gợi ý (tốn thêm một lượt, hiếm khi xảy ra).
    if (list && echoAt(r.text, list) >= 0) {
      echo = true
      if (process.env.ECHO_GUARD === '1') {
        const again = decode(join(recDir, `${s.id}.wav`), true)
        r = { ...again, ms: r.ms + again.ms }
      }
    }
    const hyp = post(r.text, s.id)
    rows.push({ id: s.id, ref, hyp, raw: r.text, echo, ms: Math.round(r.ms), sec: +r.sec.toFixed(2), ...score(ref, hyp, s.terms) })
  }
  return { id, hints: withHints, loadMs: Math.round(loadMs), rssMb: Math.round((process.memoryUsage().rss - rss0) / 1e6), rows }
}

// ---------- tiến trình cha ----------
const dirMb = (d) => {
  let n = 0
  for (const f of readdirSync(d, { recursive: true })) {
    const st = statSync(join(d, f))
    if (st.isFile() && /\.(onnx|ort|txt|vocab|json|model|bin|weights)$/i.test(f)) n += st.size
  }
  return Math.round(n / 1e6)
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '–')

async function main() {
  const want = process.argv.slice(2)
  const engines = ENGINES.filter((e) => (!want.length || want.includes(e.id)) && existsSync(join(modelDir, e.archive)))
  if (!engines.length) throw new Error('chưa có model nào: chạy download.mjs trước')
  const results = []
  for (const e of engines)
    // HINTS_ONLY=1: bỏ lượt không gợi ý (đã biết).
    for (const h of e.hints ? (process.env.HINTS_ONLY === '1' ? [true] : [false, true]) : [false]) {
      process.stdout.write(`${e.id}${h ? ' +gợi ý' : ''} … `)
      try {
        const out = execFileSync(process.execPath, [import.meta.filename, '--child', e.id, h ? '1' : '0'], {
          maxBuffer: 64 << 20,
          stdio: ['ignore', 'pipe', 'pipe']
        }).toString()
        const r = JSON.parse(out.slice(out.indexOf('{"id"')))
        r.label = e.label
        r.sizeMb = dirMb(join(modelDir, e.archive))
        results.push(r)
        console.log('ok')
      } catch (err) {
        console.log('LỖI\n' + String(err.stderr || err.message).slice(-1500))
        results.push({ id: e.id, hints: h, label: e.label, error: String(err.stderr || err.message).slice(-1500) })
      }
    }

  const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0)
  let md = `# Kết quả đo giọng nói — ${new Date().toISOString().slice(0, 16)}\n\nCPU, ${THREADS} luồng. WER/CER càng thấp càng tốt; "Từ code" = % thuật ngữ tiếng Anh nhận đúng (không tính dấu cách / dấu chấm).\n\n`
  md += '| Máy | Gợi ý | WER % | CER % | Từ code % | Trễ TB (ms) | RTF | Nạp (s) | RAM (MB) | Model (MB) |\n|---|---|---|---|---|---|---|---|---|---|\n'
  for (const r of results) {
    if (r.error) { md += `| ${r.label} | ${r.hints ? 'có' : '–'} | lỗi | | | | | | | |\n`; continue }
    const R = r.rows
    md += `| ${r.label} | ${r.hints ? 'có' : '–'} | ${pct(sum(R, 'wordErr'), sum(R, 'words'))} | ${pct(sum(R, 'charErr'), sum(R, 'chars'))} | ${pct(sum(R, 'termsHit'), sum(R, 'terms'))} | ${Math.round(sum(R, 'ms') / R.length)} | ${(sum(R, 'ms') / 1000 / sum(R, 'sec')).toFixed(3)} | ${(r.loadMs / 1000).toFixed(1)} | ${r.rssMb} | ${r.sizeMb} |\n`
  }
  md += '\n## Từng câu\n'
  for (const s of sentences) {
    const ok = results.filter((r) => !r.error && r.rows.some((x) => x.id === s.id))
    if (!ok.length) continue
    md += `\n**${s.id}** — ${ok[0].rows.find((x) => x.id === s.id).ref}\n\n`
    for (const r of ok) {
      const x = r.rows.find((y) => y.id === s.id)
      md += `- ${r.label}${r.hints ? ' +gợi ý' : ''} (${x.termsHit}/${x.terms}): ${x.hyp || '∅'}\n`
    }
  }
  const outDir = join(bench, 'results')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ glossary: GLOSSARY, results }, null, 1))
  writeFileSync(join(outDir, `${stamp}.md`), md)
  console.log(`\n${md.slice(0, md.indexOf('## Từng câu'))}\n→ .voice-bench/results/${stamp}.md`)
}

if (process.argv[2] === '--child') {
  const r = await runOne(process.argv[3], process.argv[4] === '1')
  process.stdout.write(JSON.stringify(r))
} else await main()
