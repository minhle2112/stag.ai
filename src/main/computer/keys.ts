/**
 * Phím cho computer use: đọc chuỗi tổ hợp kiểu xdotool / Claude Desktop ("ctrl+shift+a", "Return", "alt+F4") thành
 * mã phím ảo Windows (VK_*), và nhận ra tổ hợp hệ thống / phím dừng. Thuần logic, có unit test.
 */

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'win'

export interface Chord {
  modifiers: Modifier[]
  /** Phím chính (VK); null = chỉ phím bổ trợ (vd. "shift"). */
  key: number | null
  /** Tên phím chính đã chuẩn hoá (thường), để so tổ hợp. */
  name: string | null
}

const MOD_ALIASES: Record<string, Modifier> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  // Agent quen macOS: cmd / command / super → Windows: cmd ≈ ctrl (phím tắt ứng dụng), super / win / meta = phím Windows.
  cmd: 'ctrl',
  command: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  win: 'win',
  windows: 'win',
  super: 'win',
  meta: 'win'
}

export const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12,
  PAUSE: 0x13,
  CAPITAL: 0x14,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21,
  NEXT: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  SNAPSHOT: 0x2c,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  APPS: 0x5d,
  NUMPAD0: 0x60,
  MULTIPLY: 0x6a,
  ADD: 0x6b,
  SUBTRACT: 0x6d,
  DECIMAL: 0x6e,
  DIVIDE: 0x6f,
  F1: 0x70,
  NUMLOCK: 0x90,
  SCROLL: 0x91
} as const

export const MOD_VK: Record<Modifier, number> = { ctrl: VK.CONTROL, alt: VK.MENU, shift: VK.SHIFT, win: VK.LWIN }

const NAMED: Record<string, number> = {
  return: VK.RETURN,
  enter: VK.RETURN,
  kp_enter: VK.RETURN,
  tab: VK.TAB,
  iso_left_tab: VK.TAB,
  escape: VK.ESCAPE,
  esc: VK.ESCAPE,
  backspace: VK.BACK,
  back: VK.BACK,
  delete: VK.DELETE,
  del: VK.DELETE,
  forwarddelete: VK.DELETE,
  kp_delete: VK.DELETE,
  insert: VK.INSERT,
  ins: VK.INSERT,
  space: VK.SPACE,
  spacebar: VK.SPACE,
  home: VK.HOME,
  kp_home: VK.HOME,
  end: VK.END,
  kp_end: VK.END,
  pageup: VK.PRIOR,
  page_up: VK.PRIOR,
  prior: VK.PRIOR,
  kp_prior: VK.PRIOR,
  pagedown: VK.NEXT,
  page_down: VK.NEXT,
  next: VK.NEXT,
  kp_next: VK.NEXT,
  left: VK.LEFT,
  kp_left: VK.LEFT,
  arrowleft: VK.LEFT,
  right: VK.RIGHT,
  kp_right: VK.RIGHT,
  arrowright: VK.RIGHT,
  up: VK.UP,
  kp_up: VK.UP,
  arrowup: VK.UP,
  down: VK.DOWN,
  kp_down: VK.DOWN,
  arrowdown: VK.DOWN,
  capslock: VK.CAPITAL,
  caps_lock: VK.CAPITAL,
  numlock: VK.NUMLOCK,
  num_lock: VK.NUMLOCK,
  scrolllock: VK.SCROLL,
  scroll_lock: VK.SCROLL,
  pause: VK.PAUSE,
  break: VK.PAUSE,
  print: VK.SNAPSHOT,
  printscreen: VK.SNAPSHOT,
  print_screen: VK.SNAPSHOT,
  sys_req: VK.SNAPSHOT,
  contextmenu: VK.APPS,
  menu: VK.APPS,
  apps: VK.APPS,
  kp_multiply: VK.MULTIPLY,
  kp_add: VK.ADD,
  kp_subtract: VK.SUBTRACT,
  kp_decimal: VK.DECIMAL,
  kp_divide: VK.DIVIDE,
  // Ký tự dấu: mã OEM của bàn phím US (VK_OEM_*). Bàn phím khác kiểu có thể ra ký tự khác; gõ chữ dùng `type`.
  minus: 0xbd,
  '-': 0xbd,
  equal: 0xbb,
  plus: 0xbb,
  '=': 0xbb,
  comma: 0xbc,
  ',': 0xbc,
  period: 0xbe,
  '.': 0xbe,
  slash: 0xbf,
  '/': 0xbf,
  semicolon: 0xba,
  ';': 0xba,
  apostrophe: 0xde,
  quote: 0xde,
  "'": 0xde,
  grave: 0xc0,
  backquote: 0xc0,
  '`': 0xc0,
  bracketleft: 0xdb,
  '[': 0xdb,
  bracketright: 0xdd,
  ']': 0xdd,
  backslash: 0xdc,
  '\\': 0xdc
}

/** Một tên phím (không phải phím bổ trợ) → VK; null = không biết. */
export function keyCode(name: string): number | null {
  const n = name.trim()
  if (!n) return null
  const low = n.toLowerCase()
  if (low in NAMED) return NAMED[low]
  if (/^[a-z]$/.test(low)) return low.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/.test(low)) return low.charCodeAt(0)
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(low)
  if (f) return VK.F1 + Number(f[1]) - 1
  const kp = /^kp_([0-9])$/.exec(low)
  if (kp) return VK.NUMPAD0 + Number(kp[1])
  return null
}

/** "ctrl+shift+a" → Chord. Ném lỗi (tiếng Anh, cho agent) nếu có phần không hiểu. */
export function parseChord(text: string): Chord {
  const raw = text.trim()
  if (!raw) throw new Error('Empty key. Use names like "return", "escape", "ctrl+s", "alt+tab".')
  // "+" đứng riêng (vd. "ctrl++") là phím cộng.
  const parts = raw === '+' ? ['+'] : raw.replace(/\+\+$/, '+plus').split('+').map((p) => p.trim()).filter(Boolean)
  const modifiers: Modifier[] = []
  let key: number | null = null
  let name: string | null = null
  for (const p of parts) {
    const low = p.toLowerCase()
    // "control_l", "shift_r", "lshift" (xdotool) = phím bổ trợ bên trái / phải.
    const side = /^[lr]?(ctrl|control|alt|shift|win|super|meta)(_[lr])?$/.exec(low)
    const mod = MOD_ALIASES[low] ?? (side ? MOD_ALIASES[side[1]] : undefined)
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod)
      continue
    }
    if (key !== null) throw new Error(`"${text}" has more than one main key. Press them one by one, e.g. key("ctrl+a") then key("delete").`)
    const vk = low === 'plus' ? 0xbb : keyCode(p)
    if (vk === null) throw new Error(`Unknown key "${p}" in "${text}". Use names like return, escape, tab, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1–f24, a–z, 0–9.`)
    key = vk
    name = low === '+' ? 'plus' : low
  }
  return { modifiers, key, name }
}

/** Tổ hợp chuẩn hoá để so sánh: phím bổ trợ theo thứ tự cố định + phím chính. */
export function chordId(c: Chord): string {
  const order: Modifier[] = ['ctrl', 'alt', 'shift', 'win']
  const mods = order.filter((m) => c.modifiers.includes(m))
  return [...mods, c.key === null ? '' : `vk${c.key}`].filter(Boolean).join('+')
}

/**
 * Tổ hợp cấp hệ thống (thoát app, đổi app, khoá máy, menu Start, Run…): cần quyền `systemKeyCombos` trong
 * request_access. Mọi tổ hợp có phím Windows đều tính là hệ thống.
 */
export function isSystemCombo(c: Chord): boolean {
  const m = new Set(c.modifiers)
  if (m.has('win')) return true
  if (c.key === null) return false
  if (m.has('alt') && (c.key === VK.F1 + 3 || c.key === VK.TAB || c.key === VK.ESCAPE || c.key === VK.SPACE)) return true // alt+f4 / alt+tab / alt+esc / alt+space
  if (m.has('ctrl') && c.key === VK.ESCAPE) return true // ctrl+esc (Start), ctrl+shift+esc (Task Manager)
  if (m.has('ctrl') && m.has('alt') && c.key === VK.DELETE) return true
  return false
}

/** Accelerator kiểu Electron ("Control+Alt+Q") → Chord, để chặn agent gửi đúng phím dừng. */
export function chordFromAccelerator(accel: string): Chord {
  const map: Record<string, string> = { commandorcontrol: 'ctrl', cmdorctrl: 'ctrl', control: 'ctrl', ctrl: 'ctrl', alt: 'alt', shift: 'shift', super: 'win', meta: 'win' }
  return parseChord(
    accel
      .split('+')
      .map((p) => map[p.toLowerCase()] ?? p)
      .join('+')
  )
}

/** Chuỗi cần gõ → các đơn vị UTF-16 (gõ Unicode, kể cả tiếng Việt có dấu và emoji). Xuống dòng / tab gửi bằng phím thật. */
export function typeUnits(text: string): Array<{ vk: number } | { unit: number }> {
  const out: Array<{ vk: number } | { unit: number }> = []
  const s = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\n') out.push({ vk: VK.RETURN })
    else if (ch === '\t') out.push({ vk: VK.TAB })
    else out.push({ unit: s.charCodeAt(i) })
  }
  return out
}
