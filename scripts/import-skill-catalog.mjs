// Tạo danh mục skill (Cài đặt → Skill → Khám phá) từ @paperclipai/skills-catalog (MIT).
// Dùng: node scripts/import-skill-catalog.mjs <thư mục node_modules có @paperclipai/skills-catalog>
// Ghi: resources/skill-catalog/<slug>/… (file của skill) + resources/skill-catalog/catalog.json + LICENSE.md
//
// Chỉ giữ skill dùng chung được ngoài Paperclip (không gọi API / CLI của Paperclip, không chạy script);
// danh sách chọn tay ở KEEP. Frontmatter chỉ giữ name + description (khoá riêng của Paperclip bỏ đi).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const nm = process.argv[2]
if (!nm) throw new Error('Thiếu đường dẫn node_modules của Paperclip')
const pkg = join(nm, '@paperclipai/skills-catalog')
const out = 'resources/skill-catalog'

const KEEP = ['agent-browser', 'design-critique', 'doc-maintenance', 'github-pr-workflow', 'qa-acceptance', 'simplified-english', 'wireframe']

const { packageVersion, skills } = JSON.parse(readFileSync(join(pkg, 'generated/catalog.json'), 'utf8'))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

/** Frontmatter chỉ còn name + description (giữ nguyên dòng gốc của hai khoá đó). */
function trimFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return md
  const keep = []
  let on = false
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\S/.test(line)) on = /^(name|description)\s*:/.test(line)
    if (on) keep.push(line)
  }
  return `---\n${keep.join('\n')}\n---\n${md.slice(m[0].length)}`
}

const entries = []
for (const slug of KEEP) {
  const s = skills.find((x) => x.slug === slug)
  if (!s) throw new Error(`Không thấy skill ${slug} trong danh mục`)
  for (const f of s.files) {
    const src = join(pkg, s.path, f.path)
    const dst = join(out, slug, f.path)
    mkdirSync(dirname(dst), { recursive: true })
    if (f.path === 'SKILL.md') writeFileSync(dst, trimFrontmatter(readFileSync(src, 'utf8')))
    else copyFileSync(src, dst)
  }
  entries.push({
    slug,
    name: s.name,
    description: s.description,
    category: s.category,
    tags: s.tags ?? [],
    files: s.files.length,
    bytes: s.files.reduce((n, f) => n + f.sizeBytes, 0)
  })
}

writeFileSync(join(out, 'catalog.json'), JSON.stringify({ source: `@paperclipai/skills-catalog ${packageVersion} (MIT)`, entries }, null, 1) + '\n')
const lic = existsSync(join(pkg, 'LICENSE')) ? readFileSync(join(pkg, 'LICENSE'), 'utf8').trim() : ''
writeFileSync(join(out, 'LICENSE.md'), `# Skill catalog\n\nSkills adapted from @paperclipai/skills-catalog ${packageVersion} (frontmatter trimmed to name + description).\n\n\`\`\`\n${lic}\n\`\`\`\n`)
console.log(`${entries.length} skill`)
