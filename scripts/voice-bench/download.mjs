// Tải + giải nén model cho V0 vào .voice-bench/models/. Dùng: node scripts/voice-bench/download.mjs [id...]
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { ENGINES, url } from './engines.mjs'

const dir = resolve(import.meta.dirname, '..', '..', '.voice-bench', 'models')
mkdirSync(dir, { recursive: true })
const want = process.argv.slice(2)

for (const e of ENGINES.filter((x) => !want.length || want.includes(x.id))) {
  if (existsSync(join(dir, e.archive))) {
    console.log(`đã có  ${e.id}`)
    continue
  }
  const file = join(dir, `${e.archive}.tar.bz2`)
  console.log(`tải    ${e.id} ← ${url(e)}`)
  const res = await fetch(url(e))
  if (!res.ok) throw new Error(`${res.status} ${url(e)}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  console.log(`giải nén ${e.archive}`)
  // tar của Windows (bsdtar) đọc được .tar.bz2; gọi thẳng đường dẫn vì tar GNU của Git Bash hiểu "C:" là máy từ xa.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xjf', file, '-C', dir], { stdio: 'inherit' })
  rmSync(file)
}
console.log('xong')
