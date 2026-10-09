// Công cụ ghi âm cho V0 (đo thử nhận dạng giọng nói): đọc từng câu trong sentences.json,
// lưu WAV 16 kHz mono vào .voice-bench/recordings/. Chạy: npx electron scripts/voice-bench/recorder/main.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..', '..')
const outDir = process.env.VOICE_BENCH_REC || path.join(root, '.voice-bench', 'recordings')
const sentences = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sentences.json'), 'utf8'))

/** Float32 [-1, 1] → WAV PCM 16-bit mono. */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2)
  }
  return buf
}

ipcMain.handle('bench:list', () => {
  fs.mkdirSync(outDir, { recursive: true })
  return sentences.map((s) => {
    const txt = path.join(outDir, `${s.id}.txt`)
    return {
      ...s,
      text: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : s.text,
      recorded: fs.existsSync(path.join(outDir, `${s.id}.wav`))
    }
  })
})

ipcMain.handle('bench:save', (_e, id, text, samples, rate) => {
  if (!sentences.some((s) => s.id === id)) throw new Error('id lạ')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${id}.wav`), wav(new Float32Array(samples), rate))
  fs.writeFileSync(path.join(outDir, `${id}.txt`), String(text).trim(), 'utf8')
  return true
})

ipcMain.handle('bench:load', (_e, id) => {
  const f = path.join(outDir, `${id}.wav`)
  return sentences.some((s) => s.id === id) && fs.existsSync(f) ? fs.readFileSync(f) : null
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 860,
    height: 640,
    title: 'stag.ai — ghi âm đo thử giọng nói',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') }
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
