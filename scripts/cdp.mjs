// Dùng: node cdp.mjs <port> <js-expression> [text-to-type]
const [port, expr, typeText] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let n = 0; const pending = new Map()
const call = (method, params = {}) => new Promise(r => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m) }
await new Promise(r => ws.onopen = r)
if (typeText) {
  await call('Runtime.evaluate', { expression: "document.querySelector('.xterm-helper-textarea').focus()" })
  await call('Input.insertText', { text: typeText })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await new Promise(r => setTimeout(r, 6000))
}
const res = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
console.log(JSON.stringify(res.result.result?.value ?? res.result, null, 1))
ws.close()
