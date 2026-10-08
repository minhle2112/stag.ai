// Kiểm tham số Codex của app mà không gọi model: npx vite-node scripts/codex-args-check.ts
// - `codex debug prompt-input`: luật phiên (developer_instructions) có vào prompt không, tiếng Việt/dấu nháy giữ nguyên.
// - `codex mcp list --json`: máy chủ MCP "stag" đọc đúng url / token / header.
import { execFileSync } from 'node:child_process'
import { codexArgs, resolveCodex } from '../src/main/codex'

const rules = 'You are agent "Thử nghiệm" — quote \' and "double", 100% & ^caret, path C:\\a\\b\nLine 2: tiếng Việt có dấu.'
const all = codexArgs({
  rules,
  hookUrl: 'http://127.0.0.1:1/hook',
  mcpUrl: 'http://127.0.0.1:1/mcp',
  permissionMode: 'acceptEdits',
  prompt: 'Start a new session.'
})
// Chỉ giữ các cặp `-c …` (lệnh con debug/mcp không nhận cờ của TUI).
const cfg: string[] = []
for (let i = 0; i < all.length; i++) if (all[i] === '-c') cfg.push('-c', all[++i])

const exe = await resolveCodex()
console.log('exe:', exe)
const prompt = execFileSync(exe, ['debug', 'prompt-input', ...cfg], { encoding: 'utf8', env: { ...process.env, STAG_TOKEN: 't', STAG_AGENT_ID: 'a' } })
console.log('rules in prompt:', prompt.includes('Thử nghiệm') && prompt.includes('100% & ^caret') && prompt.includes('C:\\\\a\\\\b'))
console.log('CLAUDE.md fallback / developer role:', /"role":\s*"developer"/.test(prompt))
const mcp = execFileSync(exe, ['mcp', 'list', '--json', ...cfg], { encoding: 'utf8' })
const stag = (JSON.parse(mcp) as Array<{ name: string }>).find((s) => s.name === 'stag')
console.log('mcp stag:', JSON.stringify(stag))
