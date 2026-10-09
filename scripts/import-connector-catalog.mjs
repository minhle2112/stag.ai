// Tạo danh mục connector (Cài đặt → Connector → Danh mục) từ định nghĩa app của Paperclip (MIT) + logo LobeHub (MIT).
// Dùng: node scripts/import-connector-catalog.mjs <thư mục node_modules có @paperclipai/shared và @paperclipai/server>
// Ghi: src/shared/connectorCatalog.json, src/renderer/src/assets/connectors/*.svg|png, .../LICENSES.md
//
// Chỉ giữ cách kết nối dùng được ngoài Paperclip Cloud, cho máy chủ MCP:
//   oauth      = đăng nhập trình duyệt, tự đăng ký client (DCR)
//   oauth-app  = đăng nhập trình duyệt bằng OAuth app của người dùng (client id / secret)
//   key        = API key gửi trong header
//   none       = không cần đăng nhập (có thể có trường điền vào URL, vd. tên cửa hàng)
//   url        = dán URL người dùng tự tạo (token nằm trong URL, vd. Zapier)
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const nm = process.argv[2]
if (!nm) throw new Error('Thiếu đường dẫn node_modules của Paperclip')
const defs = join(nm, '@paperclipai/shared/dist/app-definitions')
const brands = join(nm, '@paperclipai/server/ui-dist/brands/apps')
const outLogos = 'src/renderer/src/assets/connectors'
mkdirSync(outLogos, { recursive: true })

/** Logo là cả chữ (icon + tên): chỉ giữ phần icon vuông bên trái. */
const CROP = { 'context7.svg': 28, 'context7-dark.svg': 28 }

const logo = (url) => {
  if (!url) return undefined
  const name = url.split('/').pop()
  if (!existsSync(join(brands, name))) return undefined
  if (CROP[name]) {
    const n = CROP[name]
    const svg = readFileSync(join(brands, name), 'utf8').replace(/<svg([^>]*?)width="[^"]*"([^>]*?)height="[^"]*"([^>]*?)viewBox="[^"]*"/, `<svg$1width="${n}"$2height="${n}"$3viewBox="0 0 ${n} ${n}"`)
    writeFileSync(join(outLogos, name), svg)
  } else copyFileSync(join(brands, name), join(outLogos, name))
  return name
}

function method(m) {
  if (m.transport !== 'mcp_remote' || m.oauthStrategy) return null
  const own = m.ownershipModes ?? []
  const d = m.defaults ?? {}
  const base = {
    key: m.key,
    label: m.label ?? '',
    capability: m.capabilityProfile ? { label: m.capabilityProfile.label, description: m.capabilityProfile.description ?? '' } : undefined,
    guide: m.guidanceMd ?? '',
    warnings: m.warnings ?? [],
    docs: m.consoleLinks?.docs,
    register: m.consoleLinks?.register,
    serverUrl: d.serverUrl,
    serverUrlTemplate: d.serverUrlTemplate,
    fields: (m.tenantFields ?? []).map((f) => ({ key: f.key, label: f.label, placeholder: f.placeholder ?? '', help: f.helperMd ?? '', pattern: f.validation?.pattern }))
  }
  if (m.auth === 'oauth') {
    const oauth = {
      authorizationEndpoint: d.authorizationEndpoint,
      tokenEndpoint: d.tokenEndpoint,
      scopes: d.scopesHint,
      params: d.oauthAuthorizationParams
    }
    return { ...base, kind: own.includes('dcr') ? 'oauth' : 'oauth-app', oauth }
  }
  if (m.auth === 'api_key') {
    const f = (m.credentialFields ?? [])[0]
    const p = m.keyPlacement
    if (!f || p?.location !== 'header') return null
    return { ...base, kind: 'key', header: { name: p.name, prefix: p.prefix ?? '' }, keyLabel: f.label, keyPlaceholder: f.placeholder ?? '' }
  }
  if (m.auth === 'none') return { ...base, kind: d.serverUrl || d.serverUrlTemplate ? 'none' : 'url' }
  return null
}

const entries = []
for (const f of readdirSync(defs).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(defs, f), 'utf8'))
  const methods = d.methods.map(method).filter(Boolean)
  if (!methods.length) continue
  entries.push({
    slug: d.slug,
    name: d.name,
    description: d.description,
    categories: d.categories ?? [],
    featured: !!d.featured,
    docsUrl: d.docsUrl,
    logo: logo(d.branding?.logoUrl),
    logoDark: logo(d.branding?.darkLogoUrl),
    methods
  })
}

// Máy chủ chạy trên máy (stdio), không có trong danh mục Paperclip.
entries.push(
  {
    slug: 'playwright',
    name: 'Playwright',
    description: 'Agent điều khiển một trình duyệt riêng: mở trang, bấm, đọc, chụp màn hình. Chạy trên máy bằng npx, không cần tài khoản.',
    categories: ['developer'],
    featured: false,
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    methods: [{ key: 'local', kind: 'stdio', label: '', guide: '', warnings: [], fields: [], command: 'npx', args: ['-y', '@playwright/mcp@latest'] }]
  },
  {
    slug: 'filesystem',
    name: 'Filesystem',
    description: 'Đọc / ghi file trong các thư mục bạn cho phép. Chạy trên máy bằng npx.',
    categories: ['developer'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    methods: [
      {
        key: 'local',
        kind: 'stdio',
        label: '',
        guide: 'Thêm thư mục được phép ở ô Tham số trên trang của connector sau khi kết nối (mặc định: thư mục dự án của phiên).',
        warnings: [],
        fields: [],
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
      }
    ]
  }
)
entries.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(
  'src/shared/connectorCatalog.json',
  JSON.stringify({ source: 'Paperclip app definitions (@paperclipai/shared, MIT) + stag.ai local servers', entries }, null, 1) + '\n'
)
const lic = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim() : '')
writeFileSync(
  join(outLogos, 'LICENSES.md'),
  `# Connector catalog and logos\n\nCatalog data adapted from Paperclip app definitions (@paperclipai/shared).\n\n\`\`\`\n${lic(join(nm, '@paperclipai/shared/LICENSE'))}\n\`\`\`\n\nLogos from LobeHub icons, as shipped by Paperclip. Brand names and logos belong to their owners.\n\n\`\`\`\n${lic(join(brands, 'LOBE-LICENSE'))}\n\`\`\`\n`
)
console.log(`${entries.length} connector, ${entries.reduce((n, e) => n + e.methods.length, 0)} cách kết nối`)
