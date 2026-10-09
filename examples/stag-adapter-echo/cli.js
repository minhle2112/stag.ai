#!/usr/bin/env node
// Adapter mẫu cho stag.ai: in ra những gì app truyền cho phiên agent, rồi nhắc lại từng dòng bạn gõ.
// Dùng làm khuôn khi viết adapter cho một CLI AI thật (xem docs/adapters.md).
const fs = require('node:fs')
const readline = require('node:readline')

const VERSION = '0.1.0'
const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log(`stag-adapter-echo ${VERSION}`)
  process.exit(0)
}

/** Giá trị của một cờ dạng `--ten giá-trị`. */
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const rulesFile = flag('--rules')
const mcpFile = flag('--mcp-config')
let rules = ''
try {
  rules = rulesFile ? fs.readFileSync(rulesFile, 'utf8') : ''
} catch {
  rules = '(không đọc được file luật phiên)'
}
let mcp = '(không có)'
try {
  if (mcpFile) mcp = Object.keys(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers ?? {}).join(', ') || '(trống)'
} catch {
  mcp = '(không đọc được)'
}

console.log(`\x1b[36mstag-adapter-echo ${VERSION}\x1b[0m`)
console.log(`model      : ${flag('--model') ?? '(mặc định)'}`)
console.log(`agent      : ${process.env.STAG_AGENT_NAME ?? '?'} (${process.env.STAG_AGENT_ID ?? '?'})`)
console.log(`thư mục    : ${process.cwd()}`)
console.log(`luật phiên : ${rulesFile ?? '(không có)'} — ${rules.split(/\r?\n/).length} dòng`)
console.log(`MCP        : ${mcp}`)
console.log(`lời mở     : ${flag('--prompt') ?? '(không có)'}`)
console.log('Gõ gì đó rồi Enter; Ctrl+C để thoát.\n')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
rl.prompt()
rl.on('line', (line) => {
  console.log(`echo: ${line}`)
  rl.prompt()
})
rl.on('close', () => process.exit(0))
