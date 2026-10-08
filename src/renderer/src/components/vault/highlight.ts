// Tô đậm từ khoá trong kết quả tìm kiếm, so khớp như main (không phân biệt hoa thường và dấu tiếng Việt).

/** Bỏ dấu + chữ thường; giống `fold` ở main/vaultIndex.ts (renderer không import được main). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

export interface Piece {
  text: string
  hit: boolean
}

/** Cắt `text` thành các đoạn, đánh dấu đoạn khớp một trong các từ của `query`. */
export function highlight(text: string, query: string): Piece[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length || !text) return text ? [{ text, hit: false }] : []
  // Gập từng ký tự, nhớ vị trí gốc của mỗi ký tự đã gập.
  let folded = ''
  const start: number[] = []
  const end: number[] = []
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) {
      start.push(i)
      end.push(i + ch.length)
    }
    folded += f
    i += ch.length
  }
  const marks = new Array<boolean>(text.length).fill(false)
  for (const t of terms) {
    for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + 1)) {
      for (let p = start[at]; p < end[at + t.length - 1]; p++) marks[p] = true
    }
  }
  const pieces: Piece[] = []
  for (let i = 0; i < text.length; i++) {
    const last = pieces[pieces.length - 1]
    if (last && last.hit === marks[i]) last.text += text[i]
    else pieces.push({ text: text[i], hit: marks[i] })
  }
  return pieces
}
