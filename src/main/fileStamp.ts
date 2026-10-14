import { promises as fs } from 'node:fs'

/**
 * Dấu của file trên đĩa (mtime + kích thước); '' = không có file. Store giữ dấu lúc đọc / ghi: dấu đổi nghĩa là
 * có ai khác ghi (bản app khác, `git checkout`…) → đọc lại trước khi sửa, không ghi đè mất dữ liệu của họ.
 */
export async function fileStamp(file: string): Promise<string> {
  const st = await fs.stat(file).catch(() => null)
  return st ? `${st.mtimeMs}:${st.size}` : ''
}
