import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonFile } from './jsonFile'

interface Doc {
  agents: unknown[]
  note?: string
}
const isDoc = (x: unknown): x is Doc => !!x && typeof x === 'object' && Array.isArray((x as Doc).agents)

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'stag-jsonfile-'))
  file = join(dir, 'agents.json')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const names = async (): Promise<string[]> => (await fs.readdir(dir)).sort()

describe('JsonFile.write', () => {
  it('writes pretty JSON, creating the folder, and leaves no temp file', async () => {
    const deep = new JsonFile(join(dir, 'a', 'b', 'x.json'))
    await deep.write({ agents: [1, 2] })
    expect(JSON.parse(await fs.readFile(deep.file, 'utf8'))).toEqual({ agents: [1, 2] })
    expect(await fs.readFile(deep.file, 'utf8')).toContain('\n  ')
    expect(await fs.readdir(join(dir, 'a', 'b'))).toEqual(['x.json'])
  })

  it('a short write right after a long one leaves no tail of the long one (the old race)', async () => {
    const f = new JsonFile(file)
    const long = { agents: Array.from({ length: 400 }, (_, i) => ({ id: `agent-${i}`, name: 'x'.repeat(40) })) }
    const short = { agents: [{ id: 'only' }] }
    // Not awaited one by one: this is what create() + saveLayout() did in the app.
    await Promise.all([f.write(long), f.write(short)])
    const text = await fs.readFile(file, 'utf8')
    expect(() => JSON.parse(text)).not.toThrow()
    expect(JSON.parse(text)).toEqual(short)
  })

  it('a burst of writes ends with exactly the last one', async () => {
    const f = new JsonFile(file)
    const jobs: Promise<void>[] = []
    for (let i = 0; i < 60; i++) jobs.push(f.write({ agents: Array.from({ length: (i * 37) % 90 }, (_, k) => k), note: `n${i}` }))
    await Promise.all(jobs)
    const last = JSON.parse(await fs.readFile(file, 'utf8')) as Doc
    expect(last.note).toBe('n59')
    expect(last.agents).toHaveLength((59 * 37) % 90)
  })

  it('writes land in call order', async () => {
    const f = new JsonFile(file)
    const seen: string[] = []
    const a = f.write({ agents: [], note: 'a' }).then(async () => seen.push(JSON.parse(await fs.readFile(file, 'utf8')).note))
    const b = f.write({ agents: [], note: 'b' }).then(async () => seen.push(JSON.parse(await fs.readFile(file, 'utf8')).note))
    await Promise.all([a, b])
    expect(seen).toEqual(['a', 'b'])
  })

  it('snapshots the data at call time, later mutations do not leak in', async () => {
    const f = new JsonFile(file)
    const data: Doc = { agents: ['one'] }
    const p = f.write(data)
    data.agents.push('two')
    await p
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ agents: ['one'] })
  })

  it('keeps the previous good version in .bak', async () => {
    const f = new JsonFile(file)
    await f.write({ agents: [], note: 'v1' })
    expect(await names()).toEqual(['agents.json'])
    await f.write({ agents: [], note: 'v2' })
    await f.write({ agents: [], note: 'v3' })
    expect(JSON.parse(await fs.readFile(file, 'utf8')).note).toBe('v3')
    expect(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8')).note).toBe('v2')
  })

  it('overwrites a stale .tmp left by a crash and never reads it', async () => {
    await fs.writeFile(`${file}.tmp`, '{"agents": [', 'utf8')
    const f = new JsonFile(file)
    await f.write({ agents: ['ok'] })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ agents: ['ok'] })
    expect(await names()).toEqual(['agents.json'])
  })

  it('a write that fails (cannot rename onto a folder) rejects and does not block the next write', async () => {
    const blocked = new JsonFile(join(dir, 'blocked.json'))
    await fs.mkdir(blocked.file) // a directory where the file should go
    await expect(blocked.write({ agents: [] })).rejects.toBeTruthy()
    await fs.rmdir(blocked.file)
    await blocked.write({ agents: ['after'] })
    expect(JSON.parse(await fs.readFile(blocked.file, 'utf8'))).toEqual({ agents: ['after'] })
  })
})

describe('JsonFile.read', () => {
  const brokenCopies = async (): Promise<string[]> => (await names()).filter((n) => n.startsWith('agents.json.broken-'))

  it('missing file and no .bak = null, not broken', async () => {
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: null, broken: false, fromBackup: false })
  })

  it('reads a good file', async () => {
    await fs.writeFile(file, JSON.stringify({ agents: [1] }), 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: { agents: [1] }, broken: false, fromBackup: false })
  })

  it('trailing garbage (the corrupted agents.json) falls back to .bak and MOVES the broken file to .broken-*', async () => {
    const good = JSON.stringify({ agents: [{ id: 'a' }] }, null, 2)
    await fs.writeFile(file, `${good}\n}e709a626-0d5a","x":780`, 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: [{ id: 'old' }] }), 'utf8')
    const r = await new JsonFile(file).read(isDoc)
    expect(r).toEqual({ data: { agents: [{ id: 'old' }] }, broken: true, fromBackup: true })
    const broken = await brokenCopies()
    expect(broken).toHaveLength(1)
    expect(await fs.readFile(join(dir, broken[0]), 'utf8')).toContain('e709a626')
    // Moved, not copied: the main file is gone until the next write.
    expect(await names()).not.toContain('agents.json')
  })

  it('opening again before any save reads .bak without making another .broken copy', async () => {
    await fs.writeFile(file, '{"agents": [', 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['b'] }), 'utf8')
    await new JsonFile(file).read(isDoc)
    const again = await new JsonFile(file).read(isDoc)
    expect(again).toEqual({ data: { agents: ['b'] }, broken: false, fromBackup: true })
    expect(await brokenCopies()).toHaveLength(1)
  })

  it('missing main file but a good .bak = data from .bak', async () => {
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['b'] }), 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: { agents: ['b'] }, broken: false, fromBackup: true })
  })

  it('broken file and no .bak = null + broken, file moved aside; next open is clean', async () => {
    await fs.writeFile(file, '{"agents": [', 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: null, broken: true, fromBackup: false })
    expect(await brokenCopies()).toHaveLength(1)
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: null, broken: false, fromBackup: false })
  })

  it('broken file and a broken .bak = null + broken', async () => {
    await fs.writeFile(file, 'nope', 'utf8')
    await fs.writeFile(`${file}.bak`, '{{', 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: null, broken: true, fromBackup: false })
  })

  it('valid JSON of the wrong shape counts as broken', async () => {
    await fs.writeFile(file, JSON.stringify({ hello: 1 }), 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['b'] }), 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: { agents: ['b'] }, broken: true, fromBackup: true })
    // JSON "null" too.
    await fs.writeFile(file, 'null', 'utf8')
    expect((await new JsonFile(file).read(isDoc)).broken).toBe(true)
  })

  it('an empty / whitespace-only file is broken: .bak is used and the empty file is moved aside', async () => {
    await fs.writeFile(file, '  \n', 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['b'] }), 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: { agents: ['b'] }, broken: true, fromBackup: true })
    expect(await brokenCopies()).toHaveLength(1)
    expect(await names()).not.toContain('agents.json')
  })

  it('a zero-byte file with no .bak is broken with no data', async () => {
    await fs.writeFile(file, '', 'utf8')
    expect(await new JsonFile(file).read(isDoc)).toEqual({ data: null, broken: true, fromBackup: false })
  })

  it('round trip: write, corrupt main by hand, read recovers the previous write', async () => {
    const f = new JsonFile(file)
    await f.write({ agents: ['v1'] })
    await f.write({ agents: ['v2'] })
    await fs.appendFile(file, '}}}', 'utf8')
    const r = await f.read(isDoc)
    expect(r.fromBackup).toBe(true)
    expect(r.data).toEqual({ agents: ['v1'] })
  })
})

describe('JsonFile.write over a damaged main file', () => {
  it('an empty main file does not overwrite a good .bak', async () => {
    await fs.writeFile(file, '', 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['good'] }), 'utf8')
    await new JsonFile(file).write({ agents: ['new'] })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ agents: ['new'] })
    expect(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))).toEqual({ agents: ['good'] })
  })

  it('a corrupt main file does not overwrite a good .bak', async () => {
    await fs.writeFile(file, '{"agents": [1,', 'utf8')
    await fs.writeFile(`${file}.bak`, JSON.stringify({ agents: ['good'] }), 'utf8')
    await new JsonFile(file).write({ agents: ['new'] })
    expect(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))).toEqual({ agents: ['good'] })
  })

  it('a good main file still becomes the new .bak', async () => {
    await fs.writeFile(file, JSON.stringify({ agents: ['prev'] }), 'utf8')
    await new JsonFile(file).write({ agents: ['new'] })
    expect(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))).toEqual({ agents: ['prev'] })
  })
})
