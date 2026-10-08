// Dùng: node shot.mjs <port> <file.png> [chuỗi trong URL của target]
// Mặc định chụp cửa sổ app (title stag.ai). Tab browser trong app là target riêng: truyền chuỗi URL để chụp nó.
import { writeFileSync } from 'node:fs'
const [port, out, urlPart] = process.argv.slice(2)
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page')
const t = urlPart ? targets.find(t => t.url.includes(urlPart)) : (targets.find(t => t.title === 'stag.ai') ?? targets[0])
if (!t) { console.error('không thấy target'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r)
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { writeFileSync(out, Buffer.from(m.result.data, 'base64')); ws.close() } }
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
