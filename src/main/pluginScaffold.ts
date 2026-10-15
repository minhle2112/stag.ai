import type { PluginScaffoldRequest } from '@shared/plugins'

/**
 * File của một plugin mới (Cài đặt → Plugin → "Tạo plugin"). SDK worker (stag-plugin-sdk.mjs) chép riêng từ
 * resources/plugin-sdk. Mẫu basic: tool + nút ở thanh bên + dữ liệu riêng; page: thêm tab trang riêng.
 * Nội dung file viết cho người / agent viết plugin nên luôn bằng tiếng Anh (không theo ngôn ngữ giao diện).
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
      description: `${req.name}: a new plugin created from the stag.ai template.`,
      author: '',
      capabilities: ['agent.tools.register', 'ui.sidebar.register', 'plugin.state.read', 'plugin.state.write', ...(page ? ['ui.page.register'] : [])],
      entrypoints: { worker: './worker.mjs', ...(page ? { ui: './ui' } : {}) },
      instanceConfigSchema: {
        type: 'object',
        properties: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' } }
      },
      tools: [
        {
          name: tool,
          displayName: 'Hello',
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

  const worker = `// Worker of the plugin "${req.name}" (see package.json → stagPlugin). After editing: Settings → Plugins → "Reload package".
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

runWorker(
  definePlugin({
    async setup(ctx) {
      // Tool for agents: its name in the stag MCP server is <plugin id>__${tool}.
      ctx.tools.register('${tool}', async ({ name }) => {
        const { greeting = 'Hello' } = await ctx.config.get()
        return { content: \`\${greeting}, \${name}!\` }
      })

      // Sidebar button: counts clicks (the plugin's own data).
      ctx.actions.register('click', async () => {
        const clicks = ((await ctx.state.get('clicks')) ?? 0) + 1
        await ctx.state.set('clicks', clicks)
        ctx.streams.emit('clicks', { clicks })
        return { message: \`Clicked \${clicks} time\${clicks === 1 ? '' : 's'}.\` }
      })
${
  page
    ? `
      // The page (ui/index.html) reads this data through host.getData('info').
      ctx.data.register('info', async (_params, run) => ({
        clicks: (await ctx.state.get('clicks')) ?? 0,
        workspace: run.workspaceName ?? null
      }))
`
    : ''
}
      ctx.logger.info(${JSON.stringify(`${req.name} is ready`)})
    }
  })
)
`

  const readme = `# ${req.name}

A stag.ai plugin created from the "${page ? 'With page' : 'Basic'}" template (id \`${req.id}\`).

- \`package.json\` → \`stagPlugin\`: the manifest (capabilities, tools, buttons${page ? ', page' : ''}, settings).
- \`worker.mjs\`: code that runs in its own process.${page ? '\n- `ui/`: the page (sandboxed frame); the page SDK is at `/__stag/ui.js`.' : ''}
- \`stag-plugin-sdk.mjs\`: the worker SDK (don't edit it; new plugins get a fresh copy).

After editing, click **Reload package** in Settings → Plugins → ${req.name}. New capabilities must be approved again.
Docs: docs/plugins.md in the stag.ai source, or turn on the \`stag-plugin-author\` skill for an agent and ask it to continue.
`

  const files: Record<string, string> = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'worker.mjs': worker,
    'README.md': readme
  }
  if (page)
    files['ui/index.html'] = `<!doctype html>
<html lang="en">
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
        <p>Sidebar button clicks: <b id="clicks">…</b></p>
        <button class="primary" id="click">Click</button>
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
