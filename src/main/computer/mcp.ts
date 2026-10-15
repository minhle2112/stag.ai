/**
 * Máy chủ MCP `computer` của một phiên Claude (POST /mcp/computer-use trên hub). Tên tool, tham số và lời dặn theo
 * đúng Claude Desktop (`screenshot`, `left_click`, `computer_batch`…). Tên máy chủ không thể là `computer-use` như
 * Claude Desktop: Claude Code giữ riêng tên đó và bỏ qua máy chủ ("is a reserved MCP server name"), nên tool là
 * `mcp__computer__*`. Việc thật nằm ở service.ts.
 */
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { ComputerAsk } from '@shared/computer'
import type { ComputerService, CuResult, CuSession } from './service'

export interface ComputerMcpContext {
  session: CuSession | null
  /** Cài đặt → Máy tính bật cho agent này (đọc mỗi yêu cầu). Tắt: ẩn tool, gọi thì báo lỗi. */
  enabled: boolean
  service: ComputerService
  /** Hỏi người dùng (thẻ `computer`, luôn hỏi). */
  ask(ask: ComputerAsk): Promise<'allow' | 'always' | 'deny' | 'timeout'>
}

/** Tên máy chủ trong `mcpServers` của phiên Claude → tool `mcp__computer__*`. */
export const COMPUTER_SERVER = 'computer'

const FRONT = 'The frontmost application must be in the session allowlist at the time of this call, or this tool returns an error and does nothing.'
const COORD = 'Pixel position read directly from the most recent screenshot image, measured from the top-left corner. The server handles all scaling.'
const SCALE = 'Scale factor in [0.1, 1] for the returned image; smaller images use fewer tokens. Coordinates always stay in the full-resolution coordinate frame; never rescale coordinates yourself.'

const coordinate = z.array(z.number()).length(2).describe(`(x, y): ${COORD}`)
const modifiers = z.string().optional().describe('Modifier keys to hold during the click (e.g. "shift", "ctrl+shift"). Supports the same syntax as the key tool.')

export const COMPUTER_USE_INSTRUCTIONS = [
  'You have a computer-use MCP server named `computer` (tools named `mcp__computer__*`, the same tools as the `mcp__computer-use__*` tools of Claude Desktop) provided by stag.ai. It lets you take screenshots of the user\'s Windows desktop and control it with mouse clicks, keyboard input and scrolling.',
  '',
  '**Pick the right tool for the app.** 1) A dedicated MCP for the app if one is connected. 2) For web pages use the stag.ai browser tools (`mcp__stag__browser_*`), not computer use. 3) Computer use for native desktop apps (CapCut, Notepad, Excel, Paint, File Explorer, Settings, any third-party app) and cross-app workflows — do not decline a native-app task just because there is no dedicated MCP.',
  '',
  "**Look before you assert.** Take a screenshot before answering questions about what is on screen; `list_granted_applications` or a fresh `screenshot` is cheaper than a wrong assertion.",
  '',
  '**Loading via ToolSearch:** if these tools are deferred, load them all in one ToolSearch call: `{ query: "mcp__computer__", max_results: 30 }`.',
  '',
  '**Access flow:** before any other action call `request_access` with the list of applications you need (names as in the Start menu, e.g. "CapCut", "Notepad", "File Explorer"). The user approves them in stag.ai; call it again mid-task if you need another app. The desktop and taskbar belong to File Explorer.',
  '',
  '**Tiered apps** (the tier is shown in the approval card and returned by `request_access`):',
  '- Browsers (Chrome, Edge, Firefox, Brave, Opera…) → tier "read": visible in screenshots, clicks and typing are blocked. Use `mcp__stag__browser_*` for the web.',
  '- Terminals and IDEs (Windows Terminal, PowerShell, cmd, VS Code, Cursor, JetBrains…) → tier "click": plain left click and scrolling only; typing, key presses, right / middle / double click, modifier clicks and drag-and-drop are blocked. Use your Bash and file tools instead.',
  '- Everything else → tier "full". stag.ai itself, password managers and banking / crypto / trading apps are blocked.',
  'The tier is checked against the window under the pointer (clicks, scrolls, drags) or the window with keyboard focus (type, key) before every action; errors name the tier and what to do instead. `open_application` works at any tier.',
  '',
  'Every mouse / keyboard action returns a screenshot taken right after it (unless the user turned that off), which becomes the new coordinate reference. Use `computer_batch` for predictable sequences (click a field, type, press Return) and `zoom` for small text such as timelines.',
  '',
  '**Stop and pause.** The user can stop you at any time (stop shortcut or the bar at the top of the screen): then tools return STOPPED_BY_USER — stop and ask the user. If they move the mouse, tools return PAUSED_BY_USER — wait, then retry. Another agent may hold the computer (COMPUTER_BUSY).',
  '',
  '**Link safety.** Never click web links with computer-use tools; open URLs with the stag.ai browser tools instead. Links from emails, messages or unknown documents are suspicious by default: check the real URL and ask the user if it looks off.',
  '',
  '**Financial actions:** never execute a trade, place an order, send money or start a transfer for the user; ask the user to do it.',
  '',
  'Elevated (administrator) windows, UAC prompts and the lock screen cannot be controlled: ask the user to handle them.'
].join('\n')

/** Ẩn tool khỏi tools/list nhưng vẫn gọi được (xem hideFromList trong ../mcp.ts). */
function hideAll(server: McpServer, tools: RegisteredTool[]): void {
  type Handler = (req: unknown, extra: unknown) => Promise<unknown>
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers
  const list = handlers?.get('tools/list')
  if (!handlers || !list) return
  handlers.set('tools/list', async (req, extra) => {
    for (const t of tools) t.enabled = false
    try {
      return await list(req, extra)
    } finally {
      for (const t of tools) t.enabled = true
    }
  })
}

export function createComputerMcp(ctx: ComputerMcpContext): McpServer {
  const server = new McpServer({ name: COMPUTER_SERVER, version: '0.1.0' }, { instructions: COMPUTER_USE_INSTRUCTIONS })
  const tools: RegisteredTool[] = []
  const noSession = (): CuResult => ({ content: [{ type: 'text', text: 'Your stag.ai session is not running.' }], isError: true })
  const run = (tool: string) => async (input: Record<string, unknown>): Promise<CuResult> => (ctx.session ? ctx.service.run(ctx.session, tool, input) : noSession())
  const reg = (name: string, description: string, inputSchema: Record<string, z.ZodType>, fn: (input: Record<string, unknown>) => Promise<CuResult>, readOnly = false): void => {
    tools.push(
      server.registerTool(name, { description, inputSchema, ...(readOnly ? { annotations: { readOnlyHint: true } } : {}) }, (input: Record<string, unknown>) =>
        fn(input) as Promise<{ content: CuResult['content']; isError?: boolean }>
      )
    )
  }

  reg(
    'request_access',
    'This computer is running Windows. The file manager is "File Explorer". Elevated processes — Task Manager, UAC prompts, installers running as administrator — cannot be controlled even when granted: Windows UIPI blocks input from lower-integrity processes. If one appears, ask the user to handle it manually. ' +
      'Request user permission to control a set of applications for this session. Must be called before any other tool in this server. The user sees a single card in stag.ai listing all requested apps and either allows the whole set or denies it. Call this again mid-session to add more apps; previously granted apps remain granted. Returns the granted apps, denied apps, and screenshot filtering capability.',
    {
      apps: z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(20)
        .describe('Application display names exactly as they appear in the Start menu (e.g. "Notepad", "CapCut", "File Explorer"). Names are resolved case-insensitively against installed and running apps; an exe name like "capcut.exe" also works. Do NOT use macOS-style bundle identifiers.'),
      reason: z.string().min(1).max(500).describe('One-sentence explanation shown to the user in the approval card. Explain the task, not the mechanism.'),
      clipboardRead: z.boolean().optional().describe("Also request permission to read the user's clipboard."),
      clipboardWrite: z.boolean().optional().describe("Also request permission to write the user's clipboard."),
      systemKeyCombos: z.boolean().optional().describe('Also request permission to send system-level key combos (quit app, switch app, Start menu, lock screen). Without this, those specific combos are blocked.')
    },
    async (input) => {
      if (!ctx.session) return noSession()
      if (!ctx.enabled) return ctx.service.run(ctx.session, 'request_access', input)
      const ask = await ctx.service.prepareAsk(input.apps as string[], String(input.reason ?? ''), input as Partial<ComputerAsk>)
      if (!ask.apps.length) return ctx.service.applyAsk(ctx.session, ask, 'deny')
      // Chỉ toàn app bị chặn: khỏi hỏi người dùng.
      if (ask.apps.every((a) => a.tier === 'blocked')) return ctx.service.applyAsk(ctx.session, ask, 'deny')
      const answer = await ctx.ask(ask)
      return ctx.service.applyAsk(ctx.session, ask, answer)
    }
  )

  reg(
    'list_granted_applications',
    'List the applications currently in the session allowlist, plus the active grant flags and coordinate mode. No side effects.',
    {},
    async () => (ctx.session ? ctx.service.listGranted(ctx.session) : noSession()),
    true
  )

  reg(
    'screenshot',
    `Take a screenshot of one monitor (the one with your granted apps, or the one chosen with switch_display). Applications not in the session allowlist are masked with a solid rectangle — their content is hidden from you, but the rectangle's position shows where the window is. Returns an error if the allowlist is empty. The returned image is what subsequent click coordinates are relative to.`,
    { scale: z.number().optional().describe(SCALE) },
    run('screenshot'),
    true
  )

  reg(
    'zoom',
    'Take a higher-resolution screenshot of a specific region of the last full-screen screenshot. Use this liberally to inspect small text, button labels, or fine UI details that are hard to read in the downsampled full-screen image. IMPORTANT: Coordinates in subsequent click calls always refer to the full-screen screenshot, never the zoomed image. This tool is read-only for inspecting detail.',
    {
      region: z
        .array(z.number())
        .length(4)
        .describe('(x0, y0, x1, y1): Rectangle to zoom into, in the coordinate space of the most recent full-screen screenshot. x0,y0 = top-left, x1,y1 = bottom-right.'),
      scale: z.number().optional().describe(SCALE)
    },
    run('zoom'),
    true
  )

  for (const [name, what] of [
    ['left_click', 'Left-click at the given coordinates.'],
    ['double_click', 'Double-click at the given coordinates. Selects a word in most text editors.'],
    ['triple_click', 'Triple-click at the given coordinates. Selects a line in most text editors.'],
    ['right_click', 'Right-click at the given coordinates. Opens a context menu in most applications.'],
    ['middle_click', 'Middle-click (scroll-wheel click) at the given coordinates.']
  ] as const)
    reg(name, `${what} ${FRONT}`, { coordinate, text: modifiers }, run(name))

  reg(
    'type',
    `Type text into whatever currently has keyboard focus. ${FRONT} Newlines are supported. Unicode (e.g. Vietnamese with diacritics) is typed directly. For keyboard shortcuts use \`key\` instead.`,
    { text: z.string().describe('Text to type.') },
    run('type')
  )

  reg(
    'key',
    `Press a key or key combination (e.g. "return", "escape", "ctrl+a", "ctrl+shift+tab"). ${FRONT} System-level combos (quit app, switch app, Start menu, lock screen) require the \`systemKeyCombos\` grant — without it they return an error. All other combos work.`,
    {
      text: z.string().describe('Modifiers joined with "+", e.g. "ctrl+shift+a".'),
      repeat: z.number().int().min(1).max(100).optional().describe('Number of times to repeat the key press. Default is 1.')
    },
    run('key')
  )

  reg(
    'scroll',
    `Scroll at the given coordinates. ${FRONT}`,
    {
      coordinate,
      scroll_direction: z.enum(['up', 'down', 'left', 'right']).describe('Direction to scroll.'),
      scroll_amount: z.number().int().min(0).max(100).describe('Number of scroll ticks.'),
      text: modifiers
    },
    run('scroll')
  )

  reg(
    'left_click_drag',
    `Press, move to target, and release. ${FRONT}`,
    {
      coordinate: z.array(z.number()).length(2).describe(`(x, y) end point: ${COORD}`),
      start_coordinate: z.array(z.number()).length(2).optional().describe(`(x, y) start point. If omitted, drags from the current cursor position. ${COORD}`)
    },
    run('left_click_drag')
  )

  reg('mouse_move', `Move the mouse cursor without clicking. Useful for triggering hover states. ${FRONT}`, { coordinate }, run('mouse_move'))

  reg(
    'open_application',
    'Launch an application (or ensure it is running) and bring it to the front. The target must already be in the session allowlist — call request_access first.',
    { app: z.string().min(1).max(200).describe('Display name as it appears in the Start menu (e.g. "Notepad", "CapCut"). Resolved case-insensitively.') },
    run('open_application')
  )

  reg(
    'switch_display',
    'Switch which monitor subsequent screenshots capture. Use this when the application you need is on a different monitor than the one shown. The screenshot tool tells you which monitor it captured and lists other attached monitors by name — pass one of those names here. After switching, call screenshot to see the new monitor. Pass "auto" to return to automatic monitor selection.',
    { display: z.string().min(1).max(200).describe('Monitor name from the screenshot note, or "auto" to re-enable automatic selection.') },
    run('switch_display')
  )

  reg('read_clipboard', 'Read the current clipboard contents as text. Requires the `clipboardRead` grant.', {}, run('read_clipboard'), true)
  reg('write_clipboard', 'Write text to the clipboard. Requires the `clipboardWrite` grant.', { text: z.string() }, run('write_clipboard'))
  reg('wait', 'Wait for a specified duration.', { duration: z.number().min(0).max(100).describe('Duration in seconds (0–100).') }, run('wait'), true)
  reg(
    'cursor_position',
    'Get the current mouse cursor position. Returns image-pixel coordinates relative to the most recent screenshot.',
    {},
    run('cursor_position'),
    true
  )
  reg(
    'hold_key',
    `Press and hold a key or key combination for the specified duration, then release. ${FRONT} System-level combos require the \`systemKeyCombos\` grant.`,
    {
      text: z.string().describe('Key or chord to hold, e.g. "space", "shift+down".'),
      duration: z.number().min(0).max(100).describe('Duration in seconds (0–100).')
    },
    run('hold_key')
  )
  reg(
    'left_mouse_down',
    `Press the left mouse button at the current cursor position and leave it held. ${FRONT} Use mouse_move first to position the cursor. Call left_mouse_up to release. Errors if the button is already held.`,
    {},
    run('left_mouse_down')
  )
  reg('left_mouse_up', `Release the left mouse button at the current cursor position. ${FRONT} Pairs with left_mouse_down. Safe to call even if the button is not currently held.`, {}, run('left_mouse_up'))

  const action = z
    .object({
      action: z
        .enum(['key', 'type', 'mouse_move', 'left_click', 'left_click_drag', 'right_click', 'middle_click', 'double_click', 'triple_click', 'scroll', 'hold_key', 'screenshot', 'zoom', 'cursor_position', 'left_mouse_down', 'left_mouse_up', 'wait'])
        .describe('The action to perform.'),
      coordinate: z.array(z.number()).length(2).optional().describe('(x, y) for click/mouse_move/scroll/left_click_drag end point.'),
      region: z
        .array(z.number())
        .length(4)
        .optional()
        .describe('(x0, y0, x1, y1): Rectangle to zoom into. For zoom only. Coordinate space: the full-screen screenshot taken BEFORE this batch (never a mid-batch screenshot, never a prior zoom).'),
      scale: z.number().optional().describe(`For screenshot/zoom only. ${SCALE}`),
      start_coordinate: z.array(z.number()).length(2).optional().describe('(x, y) drag start — left_click_drag only. Omit to drag from current cursor.'),
      text: z.string().optional().describe('For type: the text. For key/hold_key: the chord string. For click/scroll: modifier keys to hold.'),
      scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      scroll_amount: z.number().int().min(0).max(100).optional(),
      duration: z.number().min(0).max(100).optional().describe('Seconds (0–100). For hold_key/wait.'),
      repeat: z.number().int().min(1).max(100).optional().describe('For key: repeat count.'),
      action_summary: z.string().max(200).optional().describe('Short note of what this action does (shown to the user in stag.ai).')
    })
    .passthrough()

  reg(
    'computer_batch',
    `Execute a sequence of actions in ONE tool call. Each individual tool call requires a model→API round trip (seconds); batching a predictable sequence eliminates all but one. Use this whenever you can predict the outcome of several actions ahead — e.g. click a field, type into it, press Return. Actions execute sequentially and stop on the first error. ${FRONT} The frontmost check runs before EACH action inside the batch — if an action opens a non-allowed app, the next action's gate fires and the batch stops there. Screenshot and zoom actions are allowed and their images are returned interleaved with the per-action outputs. Coordinates you write in THIS batch — clicks AND zoom regions — always refer to the full-screen screenshot taken BEFORE this call, never to a zoom and never to a mid-batch screenshot. After the batch returns, the most recent full screenshot it produced becomes the new coordinate reference for your next call.`,
    {
      actions: z
        .array(action)
        .min(1)
        .max(50)
        .describe('List of actions. Example: [{"action":"left_click","coordinate":[100,200]},{"action":"type","text":"hello"},{"action":"key","text":"Return"},{"action":"screenshot"},{"action":"zoom","region":[100,100,400,300]}]')
    },
    run('computer_batch')
  )

  if (!ctx.enabled) hideAll(server, tools)
  return server
}
