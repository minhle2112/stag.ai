import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exists, isDir, mentionsPath, readText, samePath, today, writeIfMissing } from './fsutil'

describe('samePath', () => {
  it('không phân biệt / và \\', () => {
    expect(samePath('C:\\Users\\a\\proj', 'C:/Users/a/proj')).toBe(true)
  })

  it('không phân biệt hoa thường', () => {
    expect(samePath('C:\\Users\\A\\Proj', 'c:\\users\\a\\proj')).toBe(true)
  })

  it('bỏ dấu phân cách cuối và gộp dấu phân cách lặp', () => {
    expect(samePath('C:\\a\\b\\', 'C:/a//b')).toBe(true)
    expect(samePath('C:\\a\\b/', 'C:\\a\\b')).toBe(true)
  })

  it('đường dẫn khác nhau thì khác', () => {
    expect(samePath('C:\\a\\b', 'C:\\a\\bc')).toBe(false)
    expect(samePath('C:\\a\\b', 'C:\\a')).toBe(false)
  })
})

describe('mentionsPath', () => {
  it('tìm thấy đường dẫn viết bằng / trong văn bản khi hỏi bằng \\', () => {
    const text = '- Vault: `c:/users/a/proj/proj memory` — đọc _INDEX.md trước.'
    expect(mentionsPath(text, 'C:\\Users\\A\\Proj\\Proj memory')).toBe(true)
  })

  it('tìm thấy đường dẫn viết bằng \\ khi hỏi bằng /', () => {
    expect(mentionsPath('x C:\\Users\\a\\proj\\v y', 'C:/Users/a/proj/v/')).toBe(true)
  })

  it('không nhắc tới thì false', () => {
    expect(mentionsPath('vault khác: C:\\other\\v', 'C:\\Users\\a\\proj\\v')).toBe(false)
    expect(mentionsPath('', 'C:\\a')).toBe(false)
  })

  it('không coi `C:\\a\\bc` là đã nhắc tới `C:\\a\\b`', () => {
    expect(mentionsPath('C:\\a\\bc', 'C:\\a\\b')).toBe(false)
    expect(mentionsPath('vault: `C:\\a\\b-old`', 'C:\\a\\b')).toBe(false)
    expect(mentionsPath('C:\\a\\b.bak', 'C:\\a\\b')).toBe(false)
    expect(mentionsPath('C:\\proj\\Dựán', 'C:\\proj\\Dự')).toBe(false)
  })

  it('tính khi đường dẫn kết thúc đúng ranh giới tên thư mục', () => {
    expect(mentionsPath('C:\\a\\b', 'C:\\a\\b')).toBe(true)
    expect(mentionsPath('- Vault: `C:\\a\\b` — đọc trước.', 'C:\\a\\b')).toBe(true)
    expect(mentionsPath('đọc C:/a/b/_INDEX.md trước', 'C:\\a\\b')).toBe(true)
    expect(mentionsPath('Vault ở C:\\a\\b.', 'C:\\a\\b')).toBe(true)
    expect(mentionsPath('(C:\\a\\b)', 'C:\\a\\b')).toBe(true)
  })

  it('lần nhắc đầu là tiền tố của tên khác thì vẫn tìm tiếp các lần sau', () => {
    expect(mentionsPath('cũ: C:\\a\\bc — mới: C:\\a\\b', 'C:\\a\\b')).toBe(true)
  })
})

describe('ghi / đọc file', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'stag-fsutil-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writeIfMissing tạo cả thư mục cha và ghi file mới', async () => {
    const file = join(dir, 'a', 'b', 'note.md')
    expect(await writeIfMissing(file, 'xin chào')).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe('xin chào')
  })

  it('writeIfMissing không bao giờ ghi đè file có sẵn', async () => {
    const file = join(dir, 'note.md')
    await fs.writeFile(file, 'của người dùng', 'utf8')
    expect(await writeIfMissing(file, 'template')).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe('của người dùng')
  })

  it('writeIfMissing vẫn báo lỗi khác EEXIST', async () => {
    // Thư mục cha thực ra là một file → lỗi thật, không được nuốt như "đã có file".
    const blocker = join(dir, 'file.txt')
    await fs.writeFile(blocker, 'x', 'utf8')
    await expect(writeIfMissing(join(blocker, 'con.md'), 'y')).rejects.toThrow()
  })

  it('readText trả null khi không có file', async () => {
    expect(await readText(join(dir, 'không có.md'))).toBeNull()
    await fs.writeFile(join(dir, 'có.md'), 'nội dung', 'utf8')
    expect(await readText(join(dir, 'có.md'))).toBe('nội dung')
  })

  it('exists / isDir', async () => {
    await fs.mkdir(join(dir, 'thư mục'))
    await fs.writeFile(join(dir, 'f.txt'), '', 'utf8')
    expect(await exists(join(dir, 'thư mục'))).toBe(true)
    expect(await exists(join(dir, 'f.txt'))).toBe(true)
    expect(await exists(join(dir, 'nope'))).toBe(false)
    expect(await isDir(join(dir, 'thư mục'))).toBe(true)
    expect(await isDir(join(dir, 'f.txt'))).toBe(false)
    expect(await isDir(join(dir, 'nope'))).toBe(false)
  })
})

describe('today', () => {
  it('dạng YYYY-MM-DD theo giờ địa phương', () => {
    const d = new Date()
    const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today()).toBe(want)
  })
})
