import { useEffect, useState } from 'react'
import type { VaultIndex } from '@shared/types'

/**
 * Chỉ mục vault (note + link) của workspace đang xem, tự đọc lại khi file trong vault đổi
 * (Obsidian, agent hoặc người dùng sửa). `tick` tăng mỗi lần vault đổi: note đang mở dựa vào đó để đọc lại nội dung.
 */
export function useVaultIndex(vaultPath: string): { index: VaultIndex | null; tick: number; error: string | null } {
  const [index, setIndex] = useState<VaultIndex | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let running = false
    let again = false
    setIndex(null)
    setError(null)
    // Gọi dồn khi đang đọc thì chỉ đọc thêm một lần sau cùng.
    const load = async (): Promise<void> => {
      if (running) {
        again = true
        return
      }
      running = true
      try {
        do {
          again = false
          const idx = await window.stag.vault.index(vaultPath)
          if (alive) {
            setIndex(idx)
            setError(null)
          }
        } while (again && alive)
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        running = false
      }
    }
    load()
    const stop = window.stag.vault.watch(vaultPath, () => {
      setTick((t) => t + 1)
      load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [vaultPath])

  return { index, tick, error }
}
