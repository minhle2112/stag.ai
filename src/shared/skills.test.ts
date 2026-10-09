import { describe, expect, it } from 'vitest'
import { effectiveSkills, frontmatterFields, normalizeSkillToggles, parseSkillMd, setSkillName, skillMd, skillOn } from './skills'
import { normalizeSettings, patchApp } from './settings'
import { DEFAULT_SETTINGS, type Settings } from './types'

describe('frontmatter của SKILL.md', () => {
  it('đọc chữ thường, chuỗi trong nháy, khối > và |, dòng nối tiếp', () => {
    const f = frontmatterFields(
      [
        'name: pdf',
        'description: "Fill forms: read, write"',
        "other: 'it''s'",
        'folded: >',
        '  one',
        '  two',
        '',
        '  three',
        'literal: |',
        '  a',
        '  b',
        'plain: first',
        '  second # comment',
        'comment: value # trailing',
        'metadata:',
        '  author: x'
      ].join('\n')
    )
    expect(f.name).toBe('pdf')
    expect(f.description).toBe('Fill forms: read, write')
    expect(f.other).toBe("it's")
    expect(f.folded).toBe('one two\n\nthree')
    expect(f.literal).toBe('a\nb')
    expect(f.plain).toBe('first second')
    expect(f.comment).toBe('value')
    expect(f.author).toBeUndefined()
  })

  it('báo lỗi tiếng Việt khi thiếu frontmatter / tên sai / tên khác thư mục / thiếu mô tả', () => {
    expect(parseSkillMd('# no front').error).toMatch(/frontmatter/)
    expect(parseSkillMd('---\nname: Bad Name\ndescription: x\n---\n').error).toMatch(/a-z/)
    expect(parseSkillMd('---\nname: a\ndescription: x\n---\n', 'b').error).toMatch(/trùng tên thư mục/)
    expect(parseSkillMd('---\nname: a\n---\n').error).toMatch(/description/)
    const ok = parseSkillMd('﻿---\r\nname: my-skill\r\ndescription: Does things\r\n---\r\n\r\n# Body\r\n', 'my-skill')
    expect(ok).toMatchObject({ name: 'my-skill', description: 'Does things', error: null })
    expect(ok.body).toContain('# Body')
  })

  it('skillMd đặt mô tả trong nháy khi cần; setSkillName chỉ đổi dòng name', () => {
    const md = skillMd('x', 'Use when: a, b', 'Body')
    expect(md).toContain('description: "Use when: a, b"')
    expect(parseSkillMd(md, 'x')).toMatchObject({ name: 'x', description: 'Use when: a, b', error: null })
    expect(skillMd('x', 'Plain words', '')).toContain('description: Plain words\n')
    const renamed = setSkillName('---\nname: old\ndescription: d\nlicense: MIT\n---\nbody', 'new-name')
    expect(renamed).toBe('---\nname: new-name\ndescription: d\nlicense: MIT\n---\nbody')
  })
})

describe('bật / tắt skill theo cấp', () => {
  const base = (): Settings => ({
    ...DEFAULT_SETTINGS,
    app: { ...DEFAULT_SETTINGS.app, skills: { toggles: { 'lib-off': false, 'claude:seo': false } } },
    workspaces: { w: { skills: { 'lib-off': true, 'codex:imagegen': false } } },
    agents: { a: { skills: { 'claude:seo': true, 'claude-plugin:shop@market': false, mine: false } } }
  })

  it('agent → workspace → app, vắng = bật', () => {
    const s = base()
    expect(skillOn(s, 'mine')).toBe(true)
    expect(skillOn(s, 'mine', 'w', 'a')).toBe(false)
    expect(skillOn(s, 'lib-off')).toBe(false)
    expect(skillOn(s, 'lib-off', 'w')).toBe(true)
    expect(skillOn(s, 'claude:seo', 'w')).toBe(false)
    expect(skillOn(s, 'claude:seo', 'w', 'a')).toBe(true)
  })

  it('effectiveSkills: skill thư viện, skill có sẵn bị tắt, plugin bị tắt', () => {
    const s = base()
    expect(effectiveSkills(s, ['mine', 'lib-off', 'other'])).toEqual({ library: ['mine', 'other'], denied: { claude: ['seo'], codex: [] }, plugins: [] })
    expect(effectiveSkills(s, ['mine', 'lib-off', 'other'], 'w', 'a')).toEqual({
      library: ['lib-off', 'other'],
      denied: { claude: [], codex: ['imagegen'] },
      plugins: ['shop@market']
    })
  })

  it('chuẩn hoá: bỏ khoá lạ, giữ khoá skill / CLI / plugin; settings bản cũ có skills rỗng', () => {
    expect(normalizeSkillToggles({ ok: true, 'Bad Key': false, 'claude:x': false, 'claude-plugin:p@m': false, 'other:y': true, n: 'yes' })).toEqual({
      ok: true,
      'claude:x': false,
      'claude-plugin:p@m': false
    })
    expect(normalizeSettings({ autoHandoff: true }).app.skills).toEqual({ toggles: {} })
    const s = normalizeSettings({ version: 2, app: { skills: { toggles: { a: false } } }, agents: { x: { skills: { 'codex:b': false } } } })
    expect(s.app.skills.toggles).toEqual({ a: false })
    expect(s.agents.x.skills).toEqual({ 'codex:b': false })
    expect(patchApp(s.app, { skills: { toggles: { b: false } } }).skills.toggles).toEqual({ b: false })
    expect(patchApp(s.app, { general: { zoom: 110 } }).skills.toggles).toEqual({ a: false })
  })
})
