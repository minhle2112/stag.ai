import { describe, expect, it } from 'vitest'
import {
  commandLabel,
  commandLine,
  detectLaunch,
  devCellName,
  launchProblem,
  packageManagerOf,
  parseLaunch,
  portInConfig,
  portInEnv,
  portInScript,
  splitCommand,
  startupFailure,
  terminalLines,
  upsertLaunch
} from './launch'

describe('detectLaunch', () => {
  it('Vite: script dev, cổng 5173, npm khi không có file lock', () => {
    expect(detectLaunch({ pkg: { scripts: { dev: 'vite', build: 'vite build' } }, files: ['package.json'] })).toEqual([
      { name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 }
    ])
  })

  it('Next + pnpm, preview của vite là 4173, cổng ghi trong lệnh thắng', () => {
    const r = detectLaunch({ pkg: { scripts: { dev: 'next dev -p 4000', start: 'next start' } }, files: ['pnpm-lock.yaml'] })
    expect(r.map((c) => [c.name, c.runtimeExecutable, c.port])).toEqual([
      ['dev', 'pnpm', 4000],
      ['start', 'pnpm', 3000]
    ])
    expect(detectLaunch({ pkg: { scripts: { preview: 'vite preview' } }, files: [] })[0].port).toBe(4173)
  })

  it('cổng trong vite.config, rồi .env, rồi mặc định', () => {
    expect(detectLaunch({ pkg: { scripts: { dev: 'vite' } }, files: [], config: 'export default { server: { host: true, port: 3001 } }' })[0].port).toBe(3001)
    expect(detectLaunch({ pkg: { scripts: { start: 'node server.js' } }, files: [], env: 'X=1\nPORT=8081\n' })[0].port).toBe(8081)
    expect(detectLaunch({ pkg: { scripts: { start: 'node server.js' } }, files: [] })[0].port).toBe(3000)
  })

  it('bỏ app desktop (electron-vite) và script lạ không phải dev/start', () => {
    expect(detectLaunch({ pkg: { scripts: { dev: 'electron-vite dev', preview: 'electron-vite preview' } }, files: [] })).toEqual([])
    expect(detectLaunch({ pkg: { scripts: { serve: 'tsc -w' } }, files: [] })).toEqual([])
  })

  it('Django khi không có package.json', () => {
    expect(detectLaunch({ pkg: null, files: ['manage.py'] })[0]).toMatchObject({ name: 'django', port: 8000 })
    expect(detectLaunch({ pkg: null, files: [] })).toEqual([])
  })
})

describe('đọc cổng / trình quản lý gói', () => {
  it('portInScript / portInEnv / portInConfig', () => {
    expect(portInScript('vite --port 5000')).toBe(5000)
    expect(portInScript('vite --port=5001')).toBe(5001)
    expect(portInScript('PORT=4001 node x')).toBe(4001)
    expect(portInScript('vite')).toBeNull()
    expect(portInEnv('PORT="7000"')).toBe(7000)
    expect(portInConfig('server:{port:99999}')).toBeNull()
  })
  it('packageManagerOf', () => {
    expect(packageManagerOf(['yarn.lock'])).toBe('yarn')
    expect(packageManagerOf(['bun.lock'])).toBe('bun')
    expect(packageManagerOf([])).toBe('npm')
  })
})

describe('launch.json', () => {
  it('parse: bỏ cấu hình hỏng và trùng tên, file hỏng → []', () => {
    const raw = JSON.stringify({
      configurations: [
        { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 },
        { name: 'WEB', runtimeExecutable: 'npm', port: 1 },
        { name: 'bad', runtimeExecutable: 'npm\nrm -rf /', port: 1 },
        { name: 'noport', runtimeExecutable: 'npm' }
      ]
    })
    expect(parseLaunch(raw).map((c) => c.name)).toEqual(['web'])
    expect(parseLaunch('{oops')).toEqual([])
    expect(parseLaunch(null)).toEqual([])
  })

  it('upsert: thêm mới, thay cùng tên, giữ trường khác của file', () => {
    const first = upsertLaunch(null, { name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 3000 })
    expect(JSON.parse(first)).toEqual({ version: '0.0.1', configurations: [{ name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 3000 }] })
    const withExtra = JSON.stringify({ ...JSON.parse(first), note: 'x' })
    const second = JSON.parse(upsertLaunch(withExtra, { name: 'DEV', runtimeExecutable: 'pnpm', port: 4000 }))
    expect(second.note).toBe('x')
    expect(second.configurations).toEqual([{ name: 'DEV', runtimeExecutable: 'pnpm', port: 4000 }])
  })

  it('launchProblem', () => {
    expect(launchProblem({ name: 'a', runtimeExecutable: 'npm', port: 80 })).toBeNull()
    expect(launchProblem({ name: 'a', runtimeExecutable: 'npm', port: 0 })).toMatch(/port/)
    expect(launchProblem({ name: 'a', runtimeExecutable: 'npm', port: 80, url: 'file:///x' })).toMatch(/url/)
  })
})

describe('dòng lệnh', () => {
  const c = { name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev', '--', '--host', 'a b'], port: 3000 }
  it('Windows gọi npm.cmd, nhãn giữ npm, tham số có dấu cách được bọc', () => {
    expect(commandLine(c, 'win32')).toBe('npm.cmd run dev -- --host "a b"')
    expect(commandLine(c, 'linux')).toBe('npm run dev -- --host "a b"')
    expect(commandLabel(c)).toBe('npm run dev -- --host "a b"')
  })
  it('splitCommand', () => {
    expect(splitCommand('npm run dev -- --title "my app"')).toEqual({ runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev', '--', '--title', 'my app'] })
    expect(splitCommand('   ')).toBeNull()
  })
  it('devCellName bỏ ký tự cấm trong tên agent', () => {
    expect(devCellName('web/app')).toBe('Dev · web-app')
  })
})

describe('chữ của terminal', () => {
  it('bỏ mã màu, giữ phần viết sau cùng của dòng có \\r', () => {
    expect(terminalLines('\x1b[32mVITE\x1b[0m ready\r\nloading 10%\rloading 100%\n\x1b]0;title\x07done')).toEqual(['VITE ready', 'loading 100%', 'done'])
  })
  it('startupFailure nhận lỗi thường gặp', () => {
    expect(startupFailure(['> x', 'npm error Missing script: "dev"'])).toBe('npm error Missing script: "dev"')
    expect(startupFailure(["foo : The term 'foo' is not recognized as the name of a cmdlet"])).toMatch(/not recognized/)
    expect(startupFailure(['VITE ready in 300 ms'])).toBeNull()
  })
})
