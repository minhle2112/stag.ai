import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@shared/types'
import type { AgentService } from './agents'
import type { BrowserService } from './browser'
import { DevServerService, portOpen } from './devServer'
import type { WorkspaceStore } from './workspace'

/** Cổng trống để thử (mở rồi đóng ngay). */
async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as { port: number }).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

function listen(port: number): Promise<Server> {
  const s = createServer((c) => c.end())
  return new Promise((r) => s.listen(port, '127.0.0.1', () => r(s)))
}

/** AgentService giả: ghi lại lệnh gõ vào ô; `output` = chữ ô terminal xuất ra. */
function fakeAgents(onCommand: (cmd: string) => void = () => {}) {
  const state = { running: false, output: '', commands: [] as string[], stopped: 0 }
  const agents = {
    async devTerminal(_ws: string, _name: string, cmd: string) {
      state.commands.push(cmd)
      state.running = true
      onCommand(cmd)
      return 'cell-1'
    },
    isRunning: () => state.running,
    has: () => true,
    terminalOutput: () => state.output,
    stop: () => {
      state.stopped++
      state.running = false
    }
  }
  return { state, agents: agents as unknown as AgentService }
}

const browser = {} as BrowserService

describe('DevServerService', () => {
  let dir: string
  let ws: Workspace
  let workspaces: WorkspaceStore
  const servers: Server[] = []

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'stag-dev-'))
    ws = { id: 'w', name: 'w', path: dir, vaultPath: join(dir, 'vault'), createdAt: '' }
    workspaces = { get: (id: string) => (id === 'w' ? ws : undefined) } as unknown as WorkspaceStore
  })

  afterEach(async () => {
    for (const s of servers.splice(0)) s.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('list: đoán từ package.json, đã lưu thì không lặp, báo cổng đang mở', async () => {
    const port = await freePort()
    servers.push(await listen(port))
    await fs.writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: `vite --port ${port}`, start: 'node s.js' } }))
    const dev = new DevServerService(workspaces, fakeAgents().agents, browser)
    await dev.save('w', { name: 'start', runtimeExecutable: 'node', runtimeArgs: ['s.js'], port: 1 })
    const l = await dev.list('w')
    expect(l.saved.map((e) => [e.name, e.command])).toEqual([['start', 'node s.js']])
    expect(l.detected.map((e) => [e.name, e.port, e.running])).toEqual([['dev', port, true]])
  })

  it('cổng đã mở: trả URL, không gõ lệnh, vẫn lưu .stag/launch.json', async () => {
    const port = await freePort()
    servers.push(await listen(port))
    const { state, agents } = fakeAgents()
    const dev = new DevServerService(workspaces, agents, browser)
    const url = await dev.start('w', { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port })
    expect(url).toBe(`http://localhost:${port}`)
    expect(state.commands).toEqual([])
    expect(JSON.parse(await fs.readFile(join(dir, '.stag', 'launch.json'), 'utf8')).configurations[0].name).toBe('web')
  })

  it('gõ lệnh vào ô terminal rồi chờ tới khi cổng mở; lần gọi song song dùng chung', async () => {
    const port = await freePort()
    const { state, agents } = fakeAgents(() => setTimeout(() => void listen(port).then((s) => servers.push(s)), 700))
    const dev = new DevServerService(workspaces, agents, browser)
    const cfg = { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port }
    const [a, b] = await Promise.all([dev.start('w', cfg), dev.start('w', cfg, { save: false })])
    expect(a).toBe(`http://localhost:${port}`)
    expect(b).toBe(a)
    expect(state.commands).toHaveLength(1)
    expect(state.commands[0]).toMatch(/^npm(\.cmd)? run dev$/)
    expect(await portOpen(port)).toBe(true)
  })

  it('hai lần start song song (cả hai đều lưu cấu hình): chỉ một ô terminal', async () => {
    const port = await freePort()
    const { state, agents } = fakeAgents(() => setTimeout(() => void listen(port).then((s) => servers.push(s)), 300))
    const dev = new DevServerService(workspaces, agents, browser)
    const cfg = { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port }
    await Promise.all([dev.start('w', cfg), dev.start('w', cfg)])
    expect(state.commands).toHaveLength(1)
  })

  it('lệnh lỗi trong terminal → báo lỗi ngay, không đợi hết giờ; log đọc được', async () => {
    const port = await freePort()
    const { state, agents } = fakeAgents(() => {
      state.output = '> x\r\n\x1b[31mnpm error Missing script: "dev"\x1b[0m\r\n'
    })
    const dev = new DevServerService(workspaces, agents, browser)
    await expect(dev.start('w', { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port })).rejects.toThrow(/Missing script/)
    expect(await dev.logs('w', 'web', { search: 'missing' })).toContain('npm error Missing script: "dev"')
    expect(dev.stop('w', 'web')).toBe(true)
    expect(state.stopped).toBe(1)
  })

  it('agentApi.start thêm server mới theo name + command + port', async () => {
    const port = await freePort()
    servers.push(await listen(port))
    const dev = new DevServerService(workspaces, fakeAgents().agents, browser)
    const api = dev.agentApi('w', 'agent-1')
    await expect(api.start({ name: 'api', command: 'node server.js' })).rejects.toThrow(/name, command and port/)
    expect(await api.start({ name: 'api', command: 'node "my server.js"', port })).toContain(`http://localhost:${port}`)
    expect(await api.list()).toContain('- api: "node "my server.js""')
  })

  it('agentApi.start hỏi người dùng trước khi chạy lệnh chưa duyệt; từ chối thì không gõ lệnh', async () => {
    const port = await freePort()
    const { state, agents } = fakeAgents(() => setTimeout(() => void listen(port).then((s) => servers.push(s)), 50))
    const dev = new DevServerService(workspaces, agents, browser)
    const asked: unknown[] = []
    let answer: 'allow' | 'deny' = 'deny'
    const api = dev.agentApi('w', 'agent-1', async (d) => {
      asked.push(d)
      return answer
    })
    expect(await api.start({ name: 'web', command: 'npm run dev', port })).toMatch(/declined/)
    expect(state.commands).toEqual([])
    expect(asked).toEqual([{ name: 'web', command: 'npm run dev', port, source: 'agent' }])
    await expect(dev.list('w')).resolves.toEqual({ saved: [], detected: [] })
    answer = 'allow'
    expect(await api.start({ name: 'web', command: 'npm run dev', port })).toContain(`http://localhost:${port}`)
    expect(asked).toHaveLength(2)
    expect(state.commands).toHaveLength(1)
    // Đã duyệt lệnh này: lần sau không hỏi lại.
    dev.stop('w', 'web')
    for (const s of servers.splice(0)) s.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(await api.start({ name: 'web' })).toContain(`http://localhost:${port}`)
    expect(asked).toHaveLength(2)
  })
})
