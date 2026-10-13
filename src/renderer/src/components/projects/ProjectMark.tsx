import { PROJECT_COLORS } from '@shared/projects'
import type { Project } from '@shared/types'
import { Icon } from '../Icon'

/** Màu nhận diện của project (CSS var, sáng / tối tự đổi). */
export function projectColor(p: Pick<Project, 'color'>): string {
  return `var(--color-p${(((p.color % PROJECT_COLORS) + PROJECT_COLORS) % PROJECT_COLORS) + 1})`
}

/** Ô vuông màu của project, hoặc icon ngôi nhà cho "Chung" (thư mục gốc). */
export function ProjectMark({ project, size = 10 }: { project: Pick<Project, 'color'> | null | undefined; size?: number }): React.JSX.Element {
  if (!project)
    return (
      <span className="inline-flex shrink-0 text-muted" aria-hidden>
        <Icon name="home" size={size + 3} />
      </span>
    )
  return <span className="inline-block shrink-0 rounded-[3px]" style={{ width: size, height: size, background: projectColor(project) }} aria-hidden />
}
