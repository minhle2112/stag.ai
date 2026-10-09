import { create } from 'zustand'
import type { SkillsList } from '@shared/types'

/** Thư viện skill của stag.ai + danh mục kèm app (Cài đặt → Skill). Các thao tác IPC trả danh sách mới → set. */
export const useSkills = create<SkillsList & { loaded: boolean; set: (l: SkillsList) => void; reload: () => Promise<void> }>((set) => {
  const reload = async (): Promise<void> => set({ ...(await window.stag.skills.list()), loaded: true })
  void reload()
  return { library: [], catalog: [], loaded: false, set: (l) => set({ ...l, loaded: true }), reload }
})
