import type { Settings, SkillsSettings } from './types'

/**
 * Skill = thư mục có SKILL.md (frontmatter `name` + `description`, rồi phần hướng dẫn). Dùng chung main + giao diện:
 * đọc / viết frontmatter, kiểm tên, bật / tắt theo cấp app → workspace → agent (Cài đặt → Skill).
 */

/** Tên skill (= tên thư mục): chữ thường, số, "-"; Claude Code và Codex cùng nhận. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const SKILL_DESC_MAX = 1024
/** Khoá bật / tắt skill có sẵn của CLI / cả plugin Claude Code. */
const INHERITED_KEY_RE = /^(claude|codex|claude-plugin):.{1,200}$/

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Tách frontmatter YAML (`---` … `---`) khỏi phần thân. */
export function splitSkillMd(md: string): { front: string | null; body: string } {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md)
  return m ? { front: m[1], body: md.slice(m[0].length) } : { front: null, body: md }
}

/**
 * Giá trị các khoá cấp đầu của frontmatter (YAML đơn giản đủ cho SKILL.md): chữ thường, "…" / '…',
 * khối `|` / `>`, dòng thụt lề nối tiếp. Khoá lồng / danh sách bỏ qua.
 */
export function frontmatterFields(front: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = front.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(lines[i])
    if (!m) continue
    let v = (m[2] ?? '').trim()
    // Dòng sau thụt lề (hoặc trống) thuộc về khoá này.
    const more: string[] = []
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && i + 2 < lines.length && /^[ \t]/.test(lines[i + 2])))) more.push(lines[++i])
    if (/^[|>][+-]?$/.test(v)) {
      const indent = Math.min(...more.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length))
      const block = more.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
      v = v.startsWith('|') ? block.join('\n') : block.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ')
      v = v.replace(/\s+$/, '')
    } else {
      if (more.length) v = [v, ...more.map((l) => l.trim())].filter(Boolean).join(' ')
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        try {
          v = JSON.parse(v) as string
        } catch {
          v = v.slice(1, -1)
        }
      } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'")
      else v = v.replace(/\s+#.*$/, '')
    }
    out[m[1]] = v
  }
  return out
}

export interface ParsedSkill {
  name: string
  description: string
  body: string
  /** Lỗi tiếng Việt hoặc null. */
  error: string | null
}

/** Đọc SKILL.md; `dirName` = tên thư mục (phải trùng `name`). */
export function parseSkillMd(md: string, dirName?: string): ParsedSkill {
  const { front, body } = splitSkillMd(md)
  if (front === null) return { name: '', description: '', body, error: 'SKILL.md phải mở đầu bằng frontmatter (--- name / description ---).' }
  const f = frontmatterFields(front)
  const name = (f.name ?? '').trim()
  const description = (f.description ?? '').trim()
  return { name, description, body, error: skillProblem(name, description, dirName) }
}

/** Lỗi của tên / mô tả (tiếng Việt) hoặc null. */
export function skillProblem(name: string, description: string, dirName?: string): string | null {
  if (!name) return 'Thiếu "name" trong frontmatter.'
  if (!SKILL_NAME_RE.test(name)) return `Tên "${name}" chỉ gồm a-z, 0-9 và "-", tối đa 64 ký tự, bắt đầu bằng chữ / số.`
  if (dirName !== undefined && dirName !== name) return `Tên "${name}" phải trùng tên thư mục "${dirName}".`
  if (!description) return 'Thiếu "description": agent dựa vào mô tả để biết khi nào dùng skill.'
  if (description.length > SKILL_DESC_MAX) return `Mô tả dài quá ${SKILL_DESC_MAX} ký tự.`
  return null
}

/** Chuỗi YAML an toàn: để trần nếu được, không thì "…" (JSON là YAML hợp lệ). */
function yamlScalar(v: string): string {
  return /^[^\s"'#&*!|>%@`{}[\],?:-][^#\n]*$/.test(v) && !/:\s/.test(v) && !/\s$/.test(v) ? v : JSON.stringify(v)
}

/** SKILL.md mới. */
export function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${yamlScalar(description.replace(/\s*\n\s*/g, ' ').trim())}\n---\n\n${body.replace(/^\s*\n/, '')}`
}

/** Đổi khoá `name` trong frontmatter (thêm nếu thiếu); giữ nguyên phần còn lại. */
export function setSkillName(md: string, name: string): string {
  const { front, body } = splitSkillMd(md)
  if (front === null) return skillMd(name, '', md)
  const lines = front.split(/\r?\n/)
  const at = lines.findIndex((l) => /^name[ \t]*:/.test(l))
  if (at >= 0) lines[at] = `name: ${name}`
  else lines.unshift(`name: ${name}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ---- bật / tắt theo cấp ----

export function normalizeSkillToggles(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(obj(raw))) if (typeof v === 'boolean' && (SKILL_NAME_RE.test(k) || INHERITED_KEY_RE.test(k))) out[k] = v
  return out
}

export function normalizeSkills(raw: unknown): SkillsSettings {
  return { toggles: normalizeSkillToggles(obj(raw).toggles) }
}

/** Skill / plugin có bật cho cấp này không: agent → workspace → app; vắng mặt = bật. */
export function skillOn(s: Settings, key: string, workspaceId?: string | null, agentId?: string | null): boolean {
  const a = agentId ? s.agents[agentId]?.skills?.[key] : undefined
  if (a !== undefined) return a
  const w = workspaceId ? s.workspaces[workspaceId]?.skills?.[key] : undefined
  if (w !== undefined) return w
  return s.app.skills.toggles[key] ?? true
}

export interface EffectiveSkills {
  /** Skill trong thư viện của stag.ai đưa vào phiên. */
  library: string[]
  /** Skill có sẵn của CLI bị tắt (tên). */
  denied: { claude: string[]; codex: string[] }
  /** Plugin Claude Code bị tắt (`plugin@marketplace`). */
  plugins: string[]
}

/** Skill thực tế của một phiên agent. `library` = tên các skill trong thư viện (không lỗi). */
export function effectiveSkills(s: Settings, library: string[], workspaceId?: string | null, agentId?: string | null): EffectiveSkills {
  const keys = new Set([
    ...Object.keys(s.app.skills.toggles),
    ...Object.keys((workspaceId && s.workspaces[workspaceId]?.skills) || {}),
    ...Object.keys((agentId && s.agents[agentId]?.skills) || {})
  ])
  const out: EffectiveSkills = { library: library.filter((n) => skillOn(s, n, workspaceId, agentId)), denied: { claude: [], codex: [] }, plugins: [] }
  for (const k of keys) {
    const m = /^(claude|codex|claude-plugin):(.+)$/.exec(k)
    if (!m || skillOn(s, k, workspaceId, agentId)) continue
    if (m[1] === 'claude-plugin') out.plugins.push(m[2])
    else out.denied[m[1] as 'claude' | 'codex'].push(m[2])
  }
  return out
}
