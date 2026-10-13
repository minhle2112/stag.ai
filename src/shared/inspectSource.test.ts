import { describe, expect, it } from 'vitest'
import { parseSrc, staticCandidates, staticTags, tagKey } from './inspectSource'
// File phát cho dự án của người dùng (plugin Vite / loader Next), JS thuần.
// @ts-expect-error — file .mjs không có kiểu
import { tagJsx, tagMarkup, tagSource, tagVue } from '../../resources/inspect/stag-inspect-transform.mjs'

const attrs = (out: string | null): string[] => [...(out ?? '').matchAll(/data-stag-src="([^"]+)"/g)].map((m) => m[1])

describe('tagJsx', () => {
  it('gắn vào thẻ HTML, bỏ qua component / fragment', () => {
    const code = ['export function Hero() {', '  return (', '    <section className="hero">', '      <Title text="x" />', '      <>', '        <a href="#">Đặt bàn</a>', '      </>', '    </section>', '  )', '}'].join('\n')
    expect(attrs(tagJsx(code, 'src/Hero.tsx'))).toEqual(['src/Hero.tsx:3:5', 'src/Hero.tsx:6:9'])
  })

  it('không nhầm so sánh, generic, chuỗi, chú thích', () => {
    const code = [
      'const ok = a < b && c > d',
      'const s = useState<string>("<div>")',
      '// <span> trong chú thích',
      "const t = `<p>${x}</p>`",
      'const f = <T,>(x: T) => x',
      'const el = cond ? <b>hi</b> : null'
    ].join('\n')
    expect(attrs(tagJsx(code, 'a.tsx'))).toEqual(['a.tsx:6:19'])
  })

  it("dấu ' trong chữ JSX và JSX lồng trong thuộc tính", () => {
    const code = ['return (', "  <p>Don't stop</p>", '  )', 'const x = <div render={() => <i>a</i>} title="a>b">ok</div>'].join('\n')
    expect(attrs(tagJsx(code, 'b.jsx'))).toEqual(['b.jsx:2:3', 'b.jsx:4:11', 'b.jsx:4:30'])
  })

  it('không gắn lần hai', () => {
    const once = tagJsx('const a = <div>x</div>', 'c.tsx')
    expect(tagJsx(once!, 'c.tsx')).toBeNull()
  })

  it('không có JSX → null', () => {
    expect(tagJsx('export const n = 1 < 2', 'd.ts')).toBeNull()
  })
})

describe('tagMarkup / tagVue / tagSource', () => {
  it('Vue: chỉ phần <template>', () => {
    const code = ['<template>', '  <div class="card">', '    <MyBtn />', '    <span v-if="a > b">x</span>', '  </template>'].join('\n').replace('  </template>', '</template>') + '\n<script setup>\nconst s = "<div>"\n</script>'
    expect(attrs(tagVue(code, 'Card.vue'))).toEqual(['Card.vue:2:3', 'Card.vue:4:5'])
  })

  it('Svelte: bỏ <script>, hiểu {…}', () => {
    const code = ['<script>', '  let s = "<p>"', '</script>', '<button on:click={() => n > 1}>+</button>', '<style>p{}</style>'].join('\n')
    expect(attrs(tagSource(code, 'App.svelte'))).toEqual(['App.svelte:4:1'])
  })

  it('HTML: từ <body>, bỏ chú thích', () => {
    const code = ['<html><head><title>x</title></head>', '<body>', '<!-- <div> -->', '<main id="m"><p>a</p></main>', '</body></html>'].join('\n')
    expect(attrs(tagSource(code, 'index.html'))).toEqual(['index.html:2:1', 'index.html:4:1', 'index.html:4:14'])
  })

  it('đuôi không hỗ trợ → null', () => {
    expect(tagSource('const a = 1', 'x.ts')).toBeNull()
    expect(tagMarkup('', 'x.html')).toBeNull()
  })
})

describe('parseSrc', () => {
  it('file code / html', () => {
    expect(parseSrc('src/App.tsx:42:5')).toMatchObject({ chip: 'code', file: 'src/App.tsx', line: 42 })
    expect(parseSrc('site/index.html:29')).toMatchObject({ chip: 'html', file: 'site/index.html', line: 29 })
  })

  it('theme con / cha, plugin', () => {
    expect(parseSrc('themes/child/header.php:4')).toMatchObject({ chip: 'theme', file: 'themes/child/header.php', line: 4 })
    const parent = parseSrc('themes/parent/footer.php:6 · (parent theme)')
    expect(parent).toMatchObject({ chip: 'theme', line: 6 })
    expect(parent.effect).toMatch(/Theme cha/)
    expect(parent.hint).toMatch(/child theme/)
    expect(parseSrc('plugins/bm-menu/views/item.php:3', true)).toMatchObject({ chip: 'plugin', inherited: true })
  })

  it('block WordPress, template part', () => {
    const b = parseSrc('post:12 · block 3 · core/paragraph')
    expect(b).toMatchObject({ chip: 'wp' })
    expect(b.label).toBe('Block core/paragraph · bài #12 · block 3')
    expect(b.hint).toMatch(/wp post get 12/)
    expect(b.file).toBeUndefined()
    expect(parseSrc('template-part:header · core/template-part')).toMatchObject({ chip: 'wp', label: 'Template part "header"' })
  })
})

describe('HTML tĩnh', () => {
  it('thẻ mở theo thứ tự, có dòng, bỏ script / chú thích', () => {
    const html = ['<!doctype html><html><head><style>.a{}</style></head>', '<body>', '<!-- <p> -->', '<header class="top  main" id="h">', '  <nav><a href="#">x</a></nav>', '</header>', '<script>const x = "<div>"</script>', '<p class=x>y</p>'].join('\n')
    const t = staticTags(html)
    expect(t.map((x) => [x.t, x.line])).toEqual([
      ['body', 2],
      ['header', 4],
      ['nav', 5],
      ['a', 5],
      ['p', 8]
    ])
    expect(tagKey(t[1])).toBe('header#h.main top')
    expect(t[4].c).toBe('x')
  })

  it('đường dẫn URL → file thử', () => {
    expect(staticCandidates('/')).toEqual(['index.html'])
    expect(staticCandidates('/menu/')).toEqual(['menu/index.html'])
    expect(staticCandidates('/menu')).toEqual(['menu.html', 'menu/index.html'])
    expect(staticCandidates('/a%20b.html')).toEqual(['a b.html'])
    expect(staticCandidates('/x/../../etc')).toEqual([])
    expect(staticCandidates('/app.js')).toEqual([])
  })
})
