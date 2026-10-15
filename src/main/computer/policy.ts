/**
 * Mức app của computer use (theo Claude Desktop): trình duyệt "read", terminal / IDE "click", còn lại "full";
 * stag.ai + app mật khẩu / tài chính / hệ thống bị chặn. Thuần logic (không gọi Win32), có unit test.
 */

import { COMPUTER_TIERS, type ComputerTier, type ComputerTierReason } from '@shared/computer'

export type { ComputerTier }
/** Nhóm của mức mặc định, để thẻ hỏi / Cài đặt nói vì sao. */
export type TierReason = ComputerTierReason

const BROWSERS = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'opera_gx.exe',
  'vivaldi.exe',
  'arc.exe',
  'iexplore.exe',
  'waterfox.exe',
  'librewolf.exe',
  'floorp.exe',
  'zen.exe',
  'thorium.exe',
  'chromium.exe',
  'browser.exe',
  'duckduckgo.exe',
  'comet.exe',
  'tor.exe',
  'palemoon.exe',
  'maxthon.exe',
  'whale.exe',
  'sidekick.exe'
]

const TERMINALS = [
  'windowsterminal.exe',
  'wt.exe',
  'openconsole.exe',
  'conhost.exe',
  'cmd.exe',
  'powershell.exe',
  'powershell_ise.exe',
  'pwsh.exe',
  'mintty.exe',
  'bash.exe',
  'wsl.exe',
  'alacritty.exe',
  'wezterm-gui.exe',
  'hyper.exe',
  'tabby.exe',
  'warp.exe',
  'kitty.exe',
  'conemu64.exe',
  'conemu.exe',
  'cmder.exe',
  'putty.exe',
  'mobaxterm.exe',
  'termius.exe',
  'orca.exe'
]

const IDES = [
  'code.exe',
  'code - insiders.exe',
  'cursor.exe',
  'windsurf.exe',
  'zed.exe',
  'devenv.exe',
  'idea64.exe',
  'idea.exe',
  'pycharm64.exe',
  'webstorm64.exe',
  'rider64.exe',
  'clion64.exe',
  'goland64.exe',
  'phpstorm64.exe',
  'rubymine64.exe',
  'datagrip64.exe',
  'dataspell64.exe',
  'rustrover64.exe',
  'studio64.exe',
  'fleet.exe',
  'sublime_text.exe',
  'atom.exe',
  'eclipse.exe',
  'trae.exe',
  'kiro.exe',
  'antigravity.exe',
  'positron.exe',
  'vscodium.exe',
  'codium.exe',
  'claude.exe',
  'codex.exe'
]

const PASSWORD_MANAGERS = [
  '1password.exe',
  'bitwarden.exe',
  'keepass.exe',
  'keepassxc.exe',
  'dashlane.exe',
  'lastpass.exe',
  'enpass.exe',
  'nordpass.exe',
  'roboform.exe',
  'keeper password manager.exe',
  'keeperpasswordmanager.exe',
  'proton pass.exe',
  'protonpass.exe',
  'passwordsafe.exe',
  'authy desktop.exe',
  'authy.exe',
  'credentialuibroker.exe'
]

const FINANCE = [
  'exodus.exe',
  'ledger live.exe',
  'trezor suite.exe',
  'electrum.exe',
  'atomic wallet.exe',
  'atomicwallet.exe',
  'wasabi wallet.exe',
  'wassabee.exe',
  'bitcoin-qt.exe',
  'sparrow.exe',
  'guarda.exe',
  'binance.exe',
  'coinbase.exe',
  'kraken.exe',
  'bybit.exe',
  'okx.exe',
  'tws.exe',
  'ibgateway.exe',
  'terminal64.exe',
  'terminal.exe',
  'ninjatrader.exe',
  'thinkorswim.exe',
  'webull desktop.exe',
  'tradingview.exe',
  'etoro.exe',
  'revolut.exe',
  'paypal.exe'
]

/** Hệ thống: chạy quyền Admin (UIPI chặn đằng nào cũng không điều khiển được) hoặc đổi được cả máy. */
const SYSTEM = ['taskmgr.exe', 'regedit.exe', 'consent.exe', 'lockapp.exe', 'logonui.exe', 'mmc.exe', 'secpol.msc', 'gpedit.exe', 'msconfig.exe', 'stag.ai.exe']

const DEFAULTS = new Map<string, { tier: ComputerTier; reason: TierReason }>()
for (const e of BROWSERS) DEFAULTS.set(e, { tier: 'read', reason: 'browser' })
for (const e of TERMINALS) DEFAULTS.set(e, { tier: 'click', reason: 'terminal' })
for (const e of IDES) DEFAULTS.set(e, { tier: 'click', reason: 'ide' })
for (const e of PASSWORD_MANAGERS) DEFAULTS.set(e, { tier: 'blocked', reason: 'password' })
for (const e of FINANCE) DEFAULTS.set(e, { tier: 'blocked', reason: 'finance' })
for (const e of SYSTEM) DEFAULTS.set(e, { tier: 'blocked', reason: 'system' })

/** Tên exe (thường, không thư mục) từ đường dẫn bất kỳ. */
export function exeKey(pathOrName: string): string {
  const base = pathOrName.trim().split(/[\\/]/).pop() ?? ''
  return base.toLowerCase()
}

/** Mức mặc định của một exe (không tính cài đặt người dùng). */
export function defaultTier(exe: string): { tier: ComputerTier; reason: TierReason } {
  return DEFAULTS.get(exeKey(exe)) ?? { tier: 'full', reason: 'other' }
}

/**
 * Mức thực tế: cửa sổ của chính stag.ai luôn chặn; còn lại theo cài đặt người dùng (khoá = tên exe thường), rồi
 * theo mặc định.
 */
export function tierOf(exe: string, opts: { self?: boolean; overrides?: Record<string, ComputerTier> } = {}): { tier: ComputerTier; reason: TierReason } {
  if (opts.self) return { tier: 'blocked', reason: 'self' }
  const k = exeKey(exe)
  const user = opts.overrides?.[k]
  if (user && COMPUTER_TIERS.includes(user)) return { tier: user, reason: 'user' }
  return defaultTier(k)
}

/** Loại thao tác để so với mức app. */
export type ActionKind =
  | { kind: 'look' } // screenshot, zoom, cursor_position, mouse_move
  | { kind: 'click'; button: 'left' | 'right' | 'middle'; count: number; modifiers: boolean }
  | { kind: 'scroll'; modifiers: boolean }
  | { kind: 'drag' }
  | { kind: 'type' }
  | { kind: 'key' }

/** null = được làm; chuỗi = lý do bị từ chối (tiếng Anh, gửi cho agent). */
export function tierAllows(tier: ComputerTier, a: ActionKind): string | null {
  if (a.kind === 'look') return null
  if (tier === 'full') return null
  if (tier === 'blocked') return 'blocked'
  if (tier === 'read') return 'read'
  // click: chỉ click trái một lần không phím bổ trợ + cuộn.
  if (a.kind === 'click' && a.button === 'left' && a.count === 1 && !a.modifiers) return null
  if (a.kind === 'scroll' && !a.modifiers) return null
  return 'click'
}

/** Câu lỗi cho agent khi mức app không cho thao tác (nói rõ mức và nên làm gì thay). */
export function tierError(app: string, tier: ComputerTier, reason: TierReason, action: string): string {
  if (tier === 'blocked') {
    const why =
      reason === 'self'
        ? 'it is stag.ai itself (you cannot click your own approval cards or settings)'
        : reason === 'password'
          ? 'it is a password manager'
          : reason === 'finance'
            ? 'it is a banking / crypto / trading app'
            : reason === 'system'
              ? 'it is a protected system app'
              : 'the user blocked it in stag.ai settings'
    return `${action} refused: "${app}" is blocked for computer use because ${why}. Ask the user to do this step themselves.`
  }
  if (tier === 'read')
    return `${action} refused: "${app}" is granted at tier "read" (browsers): you can see it in screenshots but not click or type in it. For web pages use the stag.ai browser tools (mcp__stag__browser_*) instead.`
  return `${action} refused: "${app}" is granted at tier "click" (terminals and IDEs): only a plain left click and scrolling are allowed; typing, key presses, right / middle click, double click, modifier clicks and drag-and-drop are blocked. For shell commands use your Bash tool; to edit files use your file tools.`
}
