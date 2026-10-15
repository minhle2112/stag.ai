import { describe, expect, it } from 'vitest'
import { browserToolsOn, normalizeBrowser, normalizeOrigin, normalizeScope, resolveScope, normalizeGeneral, normalizeHandoff, normalizeMemory, normalizeOverrides, normalizeSettings, normalizeVoice, parseEnv, patchApp, patchOverrides, resolveHandoff, resolveModel, splitArgs } from './settings'
import { DEFAULT_ADAPTERS, DEFAULT_GENERAL, DEFAULT_SETTINGS, DEFAULT_VOICE, type Settings } from './types'

describe('normalizeHandoff', () => {
  it('thiếu / sai kiểu → mặc định; % kẹp trong khoảng và làm tròn', () => {
    expect(normalizeHandoff(undefined)).toEqual({ autoHandoff: true, handoffPercent: 80 })
    expect(normalizeHandoff({ autoHandoff: 'yes', handoffPercent: '50' })).toEqual({ autoHandoff: true, handoffPercent: 80 })
    expect(normalizeHandoff({ autoHandoff: false, handoffPercent: 99 })).toEqual({ autoHandoff: false, handoffPercent: 95 })
    expect(normalizeHandoff({ handoffPercent: 5 }).handoffPercent).toBe(20)
    expect(normalizeHandoff({ handoffPercent: 66.6 }).handoffPercent).toBe(67)
  })
})

describe('normalizeGeneral', () => {
  it('rỗng → mặc định', () => {
    expect(normalizeGeneral(undefined)).toEqual(DEFAULT_GENERAL)
  })

  it('kẹp số, bỏ giá trị lạ, cắt khoảng trắng đường dẫn', () => {
    const g = normalizeGeneral({
      zoom: 400,
      terminalFontSize: 3,
      closeAction: 'minimize',
      projectsDir: '  D:/code  ',
      notifySound: false
    })
    expect(g.zoom).toBe(150)
    expect(g.terminalFontSize).toBe(9)
    expect(g.closeAction).toBe('quit')
    expect(g.projectsDir).toBe('D:/code')
    expect(g.notifySound).toBe(false)
  })
})

describe('normalizeSettings', () => {
  it('file bản 1 (chỉ có bàn giao ở gốc) → bản 2, giữ giá trị bàn giao', () => {
    const s = normalizeSettings({ autoHandoff: false, handoffPercent: 70 })
    expect(s.version).toBe(2)
    expect(s.app.handoff).toEqual({ autoHandoff: false, handoffPercent: 70 })
    expect(s.app.general).toEqual(DEFAULT_GENERAL)
    expect(s.workspaces).toEqual({})
    expect(s.agents).toEqual({})
  })

  it('file rỗng / hỏng kiểu → mặc định', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ version: 2, app: 'x', workspaces: [1], agents: null })).toEqual(DEFAULT_SETTINGS)
  })

  it('bản 2: giữ ghi đè hợp lệ, bỏ ghi đè rỗng / sai', () => {
    const s = normalizeSettings({
      version: 2,
      app: { general: { zoom: 125 }, handoff: { handoffPercent: 60 } },
      workspaces: { w1: { handoff: { handoffPercent: 50 } }, w2: { handoff: {} }, w3: { handoff: { autoHandoff: 'no' } } },
      agents: { a1: { handoff: { autoHandoff: false, junk: 1 } } }
    })
    expect(s.app.general.zoom).toBe(125)
    expect(s.app.handoff).toEqual({ autoHandoff: true, handoffPercent: 60 })
    expect(s.workspaces).toEqual({ w1: { handoff: { handoffPercent: 50 } } })
    expect(s.agents).toEqual({ a1: { handoff: { autoHandoff: false } } })
  })
})

describe('normalizeOverrides', () => {
  it('rỗng → null (theo cấp trên), % kẹp', () => {
    expect(normalizeOverrides(null)).toBeNull()
    expect(normalizeOverrides({ handoff: {} })).toBeNull()
    expect(normalizeOverrides({ handoff: { handoffPercent: 120 } })).toEqual({ handoff: { handoffPercent: 95 } })
  })
})

describe('patchApp', () => {
  it('chỉ đổi trường có mặt, vẫn chuẩn hoá', () => {
    const app = patchApp(DEFAULT_SETTINGS.app, { general: { zoom: 10 }, handoff: { autoHandoff: false } })
    expect(app.general).toEqual({ ...DEFAULT_GENERAL, zoom: 70 })
    expect(app.handoff).toEqual({ autoHandoff: false, handoffPercent: 80 })
  })
})

describe('resolveHandoff', () => {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    app: { ...DEFAULT_SETTINGS.app, handoff: { autoHandoff: true, handoffPercent: 80 } },
    workspaces: { w1: { handoff: { handoffPercent: 60 } } },
    agents: { a1: { handoff: { autoHandoff: false } }, a2: { handoff: { handoffPercent: 90 } } }
  }

  it('app → workspace → agent, cấp sau thắng từng trường', () => {
    expect(resolveHandoff(s, 'w2', 'a9')).toEqual({ autoHandoff: true, handoffPercent: 80 })
    expect(resolveHandoff(s, 'w1', null)).toEqual({ autoHandoff: true, handoffPercent: 60 })
    expect(resolveHandoff(s, 'w1', 'a1')).toEqual({ autoHandoff: false, handoffPercent: 60 })
    expect(resolveHandoff(s, 'w1', 'a2')).toEqual({ autoHandoff: true, handoffPercent: 90 })
  })
})

describe('adapters', () => {
  it('thiếu → mặc định; shell ô Terminal cũ (general.terminalShell của S0) được chuyển sang', () => {
    const s = normalizeSettings({ version: 2, app: { general: { terminalShell: 'gitbash' } } })
    expect(s.app.adapters.terminal).toEqual({ enabled: true, shell: 'gitbash' })
    expect(s.app.adapters.claude).toEqual(DEFAULT_ADAPTERS.claude)
    expect('terminalShell' in s.app.general).toBe(false)
    // Đã có shell ở adapter thì bỏ qua giá trị cũ.
    const t = normalizeSettings({ version: 2, app: { general: { terminalShell: 'gitbash' }, adapters: { terminal: { shell: 'cmd' } } } })
    expect(t.app.adapters.terminal.shell).toBe('cmd')
  })

  it('bỏ model / mức suy nghĩ / quyền sai dạng, tham số thêm thành một dòng', () => {
    const app = patchApp(DEFAULT_SETTINGS.app, {
      adapters: { claude: { model: 'claude-opus-5-5[1m]', effort: 'High!', defaultPermission: 'yolo' as never, extraArgs: '--a\n--b' } }
    })
    expect(app.adapters.claude.model).toBe('claude-opus-5-5[1m]')
    expect(app.adapters.claude.effort).toBe('')
    expect(app.adapters.claude.defaultPermission).toBe('default')
    expect(app.adapters.claude.extraArgs).toBe('--a --b')
    expect(patchApp(app, { adapters: { claude: { model: 'rm -rf /' } } }).adapters.claude.model).toBe('claude-opus-5-5[1m]')
    expect(app.adapters.codex).toEqual(DEFAULT_ADAPTERS.codex)
  })

  it('ghi đè model theo workspace / agent, chỉ CLI đã biết', () => {
    expect(normalizeOverrides({ models: { claude: { model: 'sonnet' }, gemini: { model: 'x' }, codex: { effort: 'BAD' } } })).toEqual({
      models: { claude: { model: 'sonnet' } }
    })
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      app: { ...DEFAULT_SETTINGS.app, adapters: { ...DEFAULT_ADAPTERS, claude: { ...DEFAULT_ADAPTERS.claude, model: 'opus', effort: 'high' } } },
      workspaces: { w1: { models: { claude: { model: 'sonnet' } } } },
      agents: { a1: { models: { claude: { effort: 'low' } } } }
    }
    expect(resolveModel(s, 'claude', 'w2', null)).toEqual({ model: 'opus', effort: 'high' })
    expect(resolveModel(s, 'claude', 'w1', 'a1')).toEqual({ model: 'sonnet', effort: 'low' })
    expect(resolveModel(s, 'codex', 'w1', 'a1')).toEqual({ model: '', effort: '' })
  })

  it('patchOverrides: thay từng mục, null bỏ mục, không đụng mục khác', () => {
    const cur = { handoff: { handoffPercent: 60 }, models: { codex: { model: 'gpt-5.6-terra' } } }
    expect(patchOverrides(cur, { handoff: null })).toEqual({ models: { codex: { model: 'gpt-5.6-terra' } } })
    expect(patchOverrides(cur, { models: { claude: { model: 'opus' } } })).toEqual({ handoff: { handoffPercent: 60 }, models: { claude: { model: 'opus' } } })
    expect(patchOverrides({ handoff: { autoHandoff: false } }, { handoff: null })).toBeNull()
  })
})

describe('splitArgs', () => {
  it('tách theo khoảng trắng, giữ nội dung trong nháy', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('  --verbose   --add-dir "C:\\My Docs\\x"  ')).toEqual(['--verbose', '--add-dir', 'C:\\My Docs\\x'])
    expect(splitArgs('-c model="o3" ""')).toEqual(['-c', 'model=o3', ''])
    expect(splitArgs('--say \\"hi\\"')).toEqual(['--say', '"hi"'])
  })
})

describe('parseEnv', () => {
  it('đọc TÊN=giá trị, bỏ ghi chú, báo dòng sai và biến của app', () => {
    const r = parseEnv('# ghi chú\nFOO=1\n\n BAR = a=b \nnot valid\nSTAG_TOKEN=x\n=1')
    expect(r.vars).toEqual({ FOO: '1', BAR: 'a=b' })
    expect(r.errors).toEqual(['Dòng 5: cần dạng TÊN=giá trị', 'Dòng 6: STAG_TOKEN do app tự đặt, không đổi được', 'Dòng 7: cần dạng TÊN=giá trị'])
  })
})

describe('khoá phạm vi + trình duyệt (S5)', () => {
  it('chuẩn hoá: mặc định, bỏ giá trị lạ, origin gọn', () => {
    expect(normalizeScope({})).toEqual({ mode: 'ask', guessShell: true, exempt: [] })
    expect(normalizeScope({ mode: 'nope', guessShell: 1, exempt: [' docs/** ', '', 'docs/**', 3] })).toEqual({ mode: 'ask', guessShell: true, exempt: ['docs/**'] })
    expect(normalizeBrowser({})).toEqual({ homePage: '', searchEngine: 'google', agentTools: true, externalPages: 'ask', allowedOrigins: [], keepCookies: false })
    const b = normalizeBrowser({ homePage: 'localhost:5173/app', searchEngine: 'bing', externalPages: 'deny', allowedOrigins: ['github.com', 'https://github.com/x', 'ftp://a', 'http://10.0.0.2:8080/'] })
    expect(b).toMatchObject({ homePage: 'https://localhost:5173/app', searchEngine: 'bing', externalPages: 'deny', allowedOrigins: ['https://github.com', 'http://10.0.0.2:8080'] })
    expect(normalizeBrowser({ homePage: 'javascript:alert(1)' }).homePage).toBe('')
    expect(normalizeBrowser({ homePage: 'http://127.0.0.1:3000' }).homePage).toBe('http://127.0.0.1:3000')
    expect(normalizeOrigin('  ')).toBeNull()
    expect(normalizeOrigin('https://bad host')).toBeNull()
    expect(normalizeOrigin('[::1]:8080')).toBe('https://[::1]:8080')
  })

  it('đọc file cũ không có scope / browser → mặc định; patchApp sửa từng trường', () => {
    const s = normalizeSettings({ version: 2, app: {} })
    expect(s.app.scope).toEqual(DEFAULT_SETTINGS.app.scope)
    expect(s.app.browser).toEqual(DEFAULT_SETTINGS.app.browser)
    const app = patchApp(s.app, { scope: { mode: 'block' }, browser: { keepCookies: true } })
    expect(app.scope).toEqual({ mode: 'block', guessShell: true, exempt: [] })
    expect(app.browser.keepCookies).toBe(true)
    expect(app.browser.agentTools).toBe(true)
  })

  it('ghi đè theo cấp: mode agent → workspace → app, exempt cộng dồn; tool trình duyệt bật / tắt theo cấp', () => {
    const s = normalizeSettings({
      version: 2,
      app: { scope: { mode: 'ask', exempt: ['*.lock'] }, browser: { agentTools: true } },
      workspaces: { w1: { scope: { mode: 'warn', exempt: ['docs/**'], bogus: 1 }, browser: { agentTools: false } } },
      agents: { a1: { scope: { mode: 'off' }, browser: { agentTools: true } } }
    })
    expect(s.workspaces.w1).toEqual({ scope: { mode: 'warn', exempt: ['docs/**'] }, browser: { agentTools: false } })
    expect(resolveScope(s, 'w1', 'a2')).toEqual({ mode: 'warn', guessShell: true, exempt: ['*.lock', 'docs/**'] })
    expect(resolveScope(s, 'w1', 'a1').mode).toBe('off')
    expect(resolveScope(s, null, null)).toEqual({ mode: 'ask', guessShell: true, exempt: ['*.lock'] })
    expect(browserToolsOn(s, 'w1', 'a2')).toBe(false)
    expect(browserToolsOn(s, 'w1', 'a1')).toBe(true)
    expect(browserToolsOn(s, 'w2', null)).toBe(true)
    expect(normalizeOverrides({ scope: { mode: 'zzz' }, browser: { agentTools: 'x' } })).toBeNull()
  })
})

describe('giọng nói (V1)', () => {
  it('mặc định, kẹp số phút, bỏ phím tắt lạ', () => {
    expect(normalizeVoice(undefined)).toEqual(DEFAULT_VOICE)
    const v = normalizeVoice({ enabled: false, hotkey: 'alt+x', unloadMinutes: 999, micId: 7, preview: 'no' })
    expect(v).toMatchObject({ enabled: false, hotkey: 'ctrl+space', unloadMinutes: 120, micId: '', preview: true })
    expect(normalizeVoice({ unloadMinutes: -3 }).unloadMinutes).toBe(0)
    // V3: máy nhận dạng, mặc định trên máy.
    expect(normalizeVoice({ engine: 'soniox' }).engine).toBe('soniox')
    expect(normalizeVoice({ engine: 'whisper' }).engine).toBe('local')
    // V4: mọi thứ tắt sẵn, phím toàn hệ thống lạ → mặc định.
    expect(normalizeVoice({})).toMatchObject({ aiFix: false, sendCommand: false, global: false, globalHotkey: 'ctrl+shift+space' })
    expect(normalizeVoice({ aiFix: true, global: true, globalHotkey: 'f8' })).toMatchObject({ aiFix: true, global: true, globalHotkey: 'f8' })
    expect(normalizeVoice({ globalHotkey: 'ctrl+alt+space' }).globalHotkey).toBe('ctrl+shift+space')
  })

  it('từ gợi ý: bỏ dấu phẩy (Qwen3 nhận CSV), trùng, mục rỗng', () => {
    expect(normalizeVoice({ hotwords: ['handleClick', 'a, b', '', 'handleClick', 5] }).hotwords).toEqual(['handleClick', 'a b'])
  })

  it('V2: luật thay từ bỏ mục hỏng / trùng vế trái, gộp khoảng trắng; tự gợi ý + lệnh nói mặc định bật', () => {
    const v = normalizeVoice({
      replacements: [{ from: ' hen  đồ click ', to: 'handleClick' }, { from: 'HEN ĐỒ CLICK', to: 'x' }, { from: '', to: 'y' }, { from: 'a' }, 'rác', { from: 'b', to: 'dòng 1\ndòng 2' }]
    })
    expect(v.replacements).toEqual([
      { from: 'hen đồ click', to: 'handleClick' },
      { from: 'b', to: 'dòng 1 dòng 2' }
    ])
    expect(v).toMatchObject({ workspaceVocab: true, commands: true })
    expect(normalizeVoice({ workspaceVocab: false, commands: 0 })).toMatchObject({ workspaceVocab: false, commands: true })
  })

  it('settings.json cũ không có voice → mặc định; patchApp chỉ đổi trường có mặt', () => {
    expect(normalizeSettings({ version: 2, app: {} }).app.voice).toEqual(DEFAULT_VOICE)
    const app = patchApp(DEFAULT_SETTINGS.app, { voice: { hotkey: 'f9' } })
    expect(app.voice).toEqual({ ...DEFAULT_VOICE, hotkey: 'f9' })
  })
})

describe('normalizeMemory: dọn _INDEX', () => {
  it('mặc định bật, 12 KB, 3 ngày; số kẹp trong khoảng; ghi đè workspace chỉ giữ khoá có mặt', () => {
    expect(normalizeMemory(undefined)).toMatchObject({ indexArchive: true, indexBudgetKb: 12, indexKeepDays: 3 })
    expect(normalizeMemory({ indexArchive: false, indexBudgetKb: 1, indexKeepDays: 500 })).toMatchObject({ indexArchive: false, indexBudgetKb: 4, indexKeepDays: 90 })
    expect(normalizeOverrides({ memory: { indexKeepDays: 7 } })?.memory).toEqual({ indexKeepDays: 7 })
  })
})

describe('computer settings', () => {
  it('is off by default, normalizes values and resolves agent → workspace → app', async () => {
    const { computerToolsOn, normalizeComputer } = await import('./settings')
    const d = normalizeSettings({ version: 2, app: {} })
    expect(d.app.computer).toMatchObject({ agentTools: false, stopHotkey: 'ctrl+alt+q', minimizeApp: true, pauseOnUser: true, screenshotAfter: true, tiers: {} })
    expect(normalizeComputer({ agentTools: true, stopHotkey: 'bogus', tiers: { 'CapCut.EXE': 'click', 'x.dll': 'full', 'a.exe': 'nope', 'c:\\a\\b.exe': 'full' } })).toMatchObject({
      agentTools: true,
      stopHotkey: 'ctrl+alt+q',
      tiers: { 'capcut.exe': 'click' }
    })
    const s = normalizeSettings({ version: 2, app: { computer: { agentTools: false } }, workspaces: { w1: { computer: { agentTools: true } } }, agents: { a2: { computer: { agentTools: false } } } })
    expect(computerToolsOn(s, 'w1', 'a1')).toBe(true)
    expect(computerToolsOn(s, 'w1', 'a2')).toBe(false)
    expect(computerToolsOn(s, 'w2', null)).toBe(false)
    expect(patchApp(s.app, { computer: { pauseOnUser: false } }).computer).toMatchObject({ agentTools: false, pauseOnUser: false })
  })
})
