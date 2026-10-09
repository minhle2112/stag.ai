import type { PluginScaffoldRequest } from '@shared/plugins'

/**
 * File của một plugin mới (Cài đặt → Plugin → "Tạo plugin"). SDK worker (stag-plugin-sdk.mjs) chép riêng từ
 * resources/plugin-sdk. Mẫu basic: tool + nút ở thanh bên + dữ liệu riêng; page: thêm tab trang riêng.
 */
export function scaffoldFiles(req: PluginScaffoldRequest): Record<string, string> {
  const page = req.template === 'page'
  const tool = 'hello'
  const manifest = {
    name: `stag-plugin-${req.id.split('.').pop()}`,
    version: '0.1.0',
    private: true,
    description: req.name,
    type: 'module',
    stagPlugin: {
      id: req.id,
      apiVersion: 1,
      displayName: req.name,
      description: `${req.name}: plugin mới tạo từ mẫu của stag.ai.`,
      author: '',
      capabilities: ['agent.tools.register', 'ui.sidebar.register', 'plugin.state.read', 'plugin.state.write', ...(page ? ['ui.page.register'] : [])],
      entrypoints: { worker: './worker.mjs', ...(page ? { ui: './ui' } : {}) },
      instanceConfigSchema: {
        type: 'object',
        properties: { greeting: { type: 'string', title: 'Lời chào', default: 'Xin chào' } }
      },
      tools: [
        {
          name: tool,
          displayName: 'Chào',
          description: 'Say hello to someone. Example tool from the stag.ai plugin template.',
          parametersSchema: { type: 'object', properties: { name: { type: 'string', description: 'Who to greet' } }, required: ['name'] }
        }
      ],
      ui: {
        slots: [
          { type: 'sidebar', id: 'click', displayName: req.name, action: 'click' },
          ...(page ? [{ type: 'page', id: 'home', displayName: req.name, path: 'index.html' }] : [])
        ]
      }
    }
  }

  const worker = `// Worker của plugin "${req.name}" (xem package.json → stagPlugin). Sửa xong: Cài đặt → Plugin → "Đọc lại gói".
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

runWorker(
  definePlugin({
    async setup(ctx) {
      // Tool cho agent: tên trong máy chủ MCP stag là <mã plugin>__${tool}.
      ctx.tools.register('${tool}', async ({ name }) => {
        const { greeting = 'Xin chào' } = await ctx.config.get()
        return { content: \`\${greeting}, \${name}!\` }
      })

      // Nút ở thanh bên: đếm số lần bấm (dữ liệu riêng của plugin).
      ctx.actions.register('click', async () => {
        const clicks = ((await ctx.state.get('clicks')) ?? 0) + 1
        await ctx.state.set('clicks', clicks)
        ctx.streams.emit('clicks', { clicks })
        return { message: \`Đã bấm \${clicks} lần.\` }
      })
${
  page
    ? `
      // Trang riêng (ui/index.html) đọc dữ liệu này qua host.getData('info').
      ctx.data.register('info', async (_params, run) => ({
        clicks: (await ctx.state.get('clicks')) ?? 0,
        workspace: run.workspaceName ?? null
      }))
`
    : ''
}
      ctx.logger.info(${JSON.stringify(`${req.name} đã sẵn sàng`)})
    }
  })
)
`

  const readme = `# ${req.name}

Plugin stag.ai tạo từ mẫu "${page ? 'Có trang' : 'Cơ bản'}" (mã \`${req.id}\`).

- \`package.json\` → \`stagPlugin\`: manifest (quyền, tool, nút${page ? ', trang' : ''}, cấu hình).
- \`worker.mjs\`: mã chạy trong tiến trình riêng.${page ? '\n- `ui/`: trang riêng (khung cách ly), SDK của trang ở `/__stag/ui.js`.' : ''}
- \`stag-plugin-sdk.mjs\`: SDK worker (đừng sửa; tạo plugin mới sẽ có bản mới).

Sửa xong bấm **Đọc lại gói** ở Cài đặt → Plugin → ${req.name}. Thêm quyền thì phải duyệt lại.
Tài liệu: docs/plugins.md trong mã nguồn stag.ai, hoặc bật skill \`stag-plugin-author\` cho agent rồi nhờ agent viết tiếp.
`

  const files: Record<string, string> = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'worker.mjs': worker,
    'README.md': readme
  }
  if (page)
    files['ui/index.html'] = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(req.name)}</title>
    <link rel="stylesheet" href="/__stag/ui.css" />
    <style>
      main { max-width: 720px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(req.name)} <span class="muted" id="ws"></span></h1>
      <div class="card">
        <p>Đã bấm nút ở thanh bên <b id="clicks">…</b> lần.</p>
        <button class="primary" id="click">Bấm</button>
      </div>
    </main>
    <script type="module">
      import { host } from '/__stag/ui.js'
      const $ = (id) => document.getElementById(id)
      async function load() {
        const info = await host.getData('info')
        $('ws').textContent = info.workspace ? '· ' + info.workspace : ''
        $('clicks').textContent = info.clicks
      }
      $('click').onclick = async () => host.toast((await host.action('click')).message)
      await host.ready
      host.onContext(load)
      host.on('clicks', load)
      await load()
    </script>
  </body>
</html>
`
  return files
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
