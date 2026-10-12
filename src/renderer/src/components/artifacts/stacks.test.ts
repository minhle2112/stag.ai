import { describe, expect, it } from 'vitest'
import { extOf, fileUrl, formatSize, previewKind } from './stacks'

describe('previewKind', () => {
  it('phân loại theo đuôi file', () => {
    expect(previewKind('a.SVG')).toBe('image')
    expect(previewKind('deck.pptx')).toBe('pptx')
    expect(previewKind('data.csv')).toBe('sheet')
    expect(previewKind('page.html')).toBe('html')
    expect(previewKind('notes.md')).toBe('markdown')
    expect(previewKind('app.exe')).toBe('other')
    expect(previewKind('src/main.rs')).toBe('text')
    expect(previewKind('Dockerfile')).toBe('text')
    expect(previewKind('.stag/artifacts/a3/v2.mp4')).toBe('video')
  })
  it('đuôi file', () => {
    expect(extOf('out/Chart.PNG')).toBe('png')
    expect(extOf('Makefile')).toBe('')
  })
})

describe('fileUrl / formatSize', () => {
  it('mã hoá từng đoạn đường dẫn', () => {
    expect(fileUrl('ws1', 'out/my chart#1.png', '2026')).toBe('stag-file://ws1/out/my%20chart%231.png?v=2026')
  })
  it('cỡ file', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
  })
})
