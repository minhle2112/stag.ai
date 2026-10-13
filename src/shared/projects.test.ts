import { describe, expect, it } from 'vitest'
import {
  agentFolder,
  autoFolder,
  CHUNG,
  copyTeam,
  crossProjectAsk,
  filterWorkLog,
  folderClash,
  joinRoot,
  monorepoCandidates,
  normFolder,
  placeOf,
  projectNameProblem,
  projectNoteRel,
  projectPair,
  projectSection,
  projectSlug,
  teamPreset,
  uniqueAgentName
} from './projects'
import { parseScope, scopeLocks } from './scope'
import type { Project, Task } from './types'

const proj = (id: string, name: string, folder: string): Project => ({ id, name, folder, goal: '', color: 0, note: projectNoteRel(name), createdAt: '' })
const web = proj('pw', 'web-shop', 'apps/web')
const mobile = proj('pm', 'mobile-app', 'apps/mobile')

describe('tên và thư mục project', () => {
  it('slug bỏ dấu tiếng Việt', () => {
    expect(projectSlug('Cổng quản trị Đơn hàng')).toBe('cong-quan-tri-don-hang')
    expect(projectSlug('  !!  ')).toBe('')
  })

  it('tên: trống, ký tự cấm, "Chung", trùng (không phân biệt hoa thường)', () => {
    expect(projectNameProblem('', [])).toBeTruthy()
    expect(projectNameProblem('a/b', [])).toBeTruthy()
    expect(projectNameProblem('chung', [])).toBeTruthy()
    expect(projectNameProblem('Web-Shop', [web])).toBe('Đã có project tên này')
    expect(projectNameProblem('Web-Shop', [web], 'pw')).toBeNull()
    expect(projectNameProblem('admin', [web])).toBeNull()
  })

  it('chuẩn hoá thư mục, chặn đường dẫn tuyệt đối / .. / thư mục của app', () => {
    expect(normFolder(' apps\\web\\ ')).toBe('apps/web')
    expect(normFolder('/apps//web/')).toBe('apps/web')
    expect(normFolder('C:/x')).toBeNull()
    expect(normFolder('../x')).toBeNull()
    expect(normFolder('apps/./web')).toBeNull()
    expect(normFolder('.stag/x')).toBeNull()
    expect(normFolder('node_modules')).toBeNull()
    expect(normFolder('')).toBeNull()
  })

  it('không trùng, không lồng thư mục', () => {
    expect(folderClash([web], 'apps/web')).toMatch(/web-shop/)
    expect(folderClash([web], 'Apps/Web/src')).toMatch(/lồng/)
    expect(folderClash([web], 'apps')).toMatch(/Chứa/)
    expect(folderClash([web], 'apps/website')).toBeNull()
    expect(folderClash([web], 'apps/web', 'pw')).toBeNull()
  })

  it('thư mục tự đặt: slug, trùng thì -2, -3', () => {
    const taken = new Set(['admin-portal', 'admin-portal-2'])
    expect(autoFolder('Admin Portal', (f) => taken.has(f))).toBe('admin-portal-3')
    expect(autoFolder('', () => false)).toBe('project-moi')
  })

  it('note vault, ghép đường dẫn kiểu Windows', () => {
    expect(projectNoteRel('web-shop')).toBe('70 Projects/web-shop/web-shop.md')
    expect(joinRoot('C:\\ws\\', 'apps/web')).toBe('C:\\ws\\apps\\web')
    expect(joinRoot('/ws', 'apps/web')).toBe('/ws/apps/web')
    expect(joinRoot('C:\\ws', '')).toBe('C:\\ws')
  })
})

describe('agent và chỗ của nó', () => {
  const ws = { projects: [web, mobile], projectLinks: [] as string[] }

  it('Chung = không project / project đã xoá', () => {
    expect(placeOf(ws, {})).toBe(CHUNG)
    expect(placeOf(ws, { projectId: 'gone' })).toBe(CHUNG)
    expect(agentFolder(ws, { projectId: 'pw' })).toBe('apps/web')
    expect(agentFolder(ws, {})).toBe('')
  })

  it('gửi việc: chỉ hỏi giữa hai project khác nhau, "Luôn cho" thì thôi', () => {
    expect(crossProjectAsk(ws, { projectId: 'pw' }, { projectId: 'pm' })?.to.name).toBe('mobile-app')
    expect(crossProjectAsk(ws, {}, { projectId: 'pm' })).toBeNull()
    expect(crossProjectAsk(ws, { projectId: 'pw' }, {})).toBeNull()
    expect(crossProjectAsk(ws, { projectId: 'pw' }, { projectId: 'pw' })).toBeNull()
    expect(crossProjectAsk({ ...ws, projectLinks: [projectPair('pm', 'pw')] }, { projectId: 'pw' }, { projectId: 'pm' })).toBeNull()
  })

  it('đội mẫu, chép đội, tên không trùng', () => {
    expect(teamPreset('duo', 'web-shop').map((t) => t.name)).toEqual(['Dev · web-shop', 'Tester · web-shop'])
    expect(teamPreset('none', 'x')).toEqual([])
    const team = copyTeam(
      [
        { id: 'a1', name: 'Dev · web-shop', role: 'Dev', kind: 'claude' },
        { id: 'a2', name: 'Terminal', role: '', kind: 'terminal' },
        { id: 'a3', name: 'Dev Mobile', role: '', kind: 'codex' }
      ],
      'admin'
    )
    expect(team).toEqual([
      { role: 'Dev', name: 'Dev · admin', kind: 'claude', cloneOf: 'a1' },
      { role: '', name: 'Dev Mobile · admin', kind: 'codex', cloneOf: 'a3' }
    ])
    expect(uniqueAgentName('Dev', (n) => ['Dev', 'Dev 2'].includes(n))).toBe('Dev 3')
  })

  it('gợi ý monorepo: apps/* và packages/* có package.json', () => {
    expect(
      monorepoCandidates([
        { path: 'apps/web', pkg: true },
        { path: 'apps/docs', pkg: false },
        { path: 'packages/ui', pkg: true },
        { path: 'src', pkg: true }
      ])
    ).toEqual(['apps/web', 'packages/ui'])
  })
})

describe('mục PROJECT trong luật phiên', () => {
  const ws = { path: 'C:\\ws', vaultPath: 'C:\\ws\\mem', projects: [{ ...web, goal: 'Bán hàng' }, mobile] }

  it('không có project → trống', () => {
    expect(projectSection({ ...ws, projects: [] }, {}, 'C:\\ws')).toBe('')
  })

  it('agent của project: tên, thư mục làm việc, note vault, mục tiêu, project khác; kết thúc bằng dòng trống', () => {
    const t = projectSection(ws, { projectId: 'pw' }, 'C:\\ws\\apps\\web')
    expect(t).toMatch(/^PROJECT\n/)
    expect(t).toContain('project "web-shop"')
    expect(t).toContain('relative to C:\\ws\\apps\\web')
    expect(t).toContain('C:\\ws\\mem\\70 Projects\\web-shop\\web-shop.md')
    expect(t).toContain('- Goal: Bán hàng')
    expect(t).toContain('"mobile-app" (apps/mobile)')
    expect(t.endsWith('\n\n')).toBe(true)
  })

  it('agent ở Chung: liệt kê mọi project', () => {
    const t = projectSection(ws, {}, 'C:\\ws')
    expect(t).toMatch(/^PROJECTS\n/)
    expect(t).toContain('"web-shop" (apps/web), "mobile-app" (apps/mobile)')
  })
})

describe('lọc nhật ký việc theo project', () => {
  const log = [
    '# 2026-10-13',
    '## Agent work (auto)',
    '- [x] "A" — [[Lead]] — done 09:00 · scope: docs/',
    '- [x] "B" — [[Dev · web-shop]] — done 10:00 · project: [[web-shop]] · scope: src/',
    '- [x] "C" — [[Dev · old]] — done 11:00 · project: [[old-project]]',
    '- [x] "D" — [[Dev · mobile]] — done 12:00 · project: [[mobile-app|Mobile]]',
    'Ghi chú tay'
  ].join('\n')

  it('project: chỉ dòng của nó; dòng không phải việc giữ nguyên', () => {
    const out = filterWorkLog(log, 'pw', [web, mobile])
    expect(out).toContain('"B"')
    expect(out).not.toContain('"A"')
    expect(out).not.toContain('"D"')
    expect(out).toContain('Ghi chú tay')
    expect(filterWorkLog(log, 'pm', [web, mobile])).toContain('"D"')
  })

  it('Chung: dòng không thẻ và dòng của project đã xoá', () => {
    const out = filterWorkLog(log, CHUNG, [web, mobile])
    expect(out).toContain('"A"')
    expect(out).toContain('"C"')
    expect(out).not.toContain('"B"')
  })
})

describe('khoá phạm vi của agent project', () => {
  const root = 'C:/ws'
  const task = (scope: string, base?: string): Task => ({ id: 't', agentId: 'a', agentName: 'A', sessionId: '', title: '', scope, status: 'open', createdAt: '', ...(base ? { base } : {}) })

  it('phạm vi tương đối tính từ thư mục project', () => {
    expect(parseScope('src/, tests/*.ts', root, 'C:/ws/apps/web').map((e) => e.key)).toEqual(['apps/web/src', 'apps/web/tests'])
    expect(scopeLocks([task('src/cart/', 'apps/web')], root)[0].entries[0].key).toBe('apps/web/src/cart')
    expect(scopeLocks([task('src/cart/')], root)[0].entries[0].key).toBe('src/cart')
  })

  it('"." của agent project = cả thư mục project, không phải cả workspace', () => {
    expect(scopeLocks([task('.', 'apps/web')], root)[0].entries[0].key).toBe('apps/web')
  })

  it('glob trong project', () => {
    const [e] = parseScope('src/**/*.tsx', root, 'C:/ws/apps/web')
    expect(e.glob?.test('apps/web/src/a/B.tsx')).toBe(true)
    expect(e.glob?.test('src/a/B.tsx')).toBe(false)
  })
})
