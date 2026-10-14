// Chống snapshot về muộn đè state mới hơn (IPC trả lời không theo thứ tự gọi khi handler ở main bất đồng bộ).

/** "Lần gọi mới nhất thắng" theo khoá (workspace, agent…): phản hồi của lần gọi cũ hơn bị bỏ. */
export interface LatestWins {
  /** Bắt đầu một lần gọi; hàm trả về cho biết phản hồi của lần này còn được dùng không. */
  begin: (key: string) => () => boolean
  /** State vừa được đặt từ nguồn mới hơn (main đẩy bản mới): bỏ mọi phản hồi đang chờ của khoá này. */
  bump: (key: string) => void
}

export function latestWins(): LatestWins {
  const seq = new Map<string, number>()
  const next = (key: string): number => {
    const n = (seq.get(key) ?? 0) + 1
    seq.set(key, n)
    return n
  }
  return {
    begin(key) {
      const n = next(key)
      return () => seq.get(key) === n
    },
    bump(key) {
      next(key)
    }
  }
}

/** Gộp các lần gọi trùng lúc theo khoá: gọi khi lần trước chưa xong thì dùng chung promise của lần đó. */
export function coalesce<T>(run: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const inflight = new Map<string, Promise<T>>()
  return (key) => {
    const cur = inflight.get(key)
    if (cur) return cur
    const p = run(key).finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}

/**
 * Nạp lần đầu + nghe main đẩy bản mới. Bản đẩy tới trước phản hồi nạp thì bỏ phản hồi đó (không mới hơn bản đẩy).
 * Nạp lỗi thì giữ mặc định, chờ bản đẩy.
 */
export function fetchThenListen<T>(fetch: () => Promise<T>, listen: (cb: (v: T) => void) => unknown, apply: (v: T) => void): void {
  let pushed = false
  listen((v) => {
    pushed = true
    apply(v)
  })
  fetch().then(
    (v) => {
      if (!pushed) apply(v)
    },
    () => {}
  )
}
