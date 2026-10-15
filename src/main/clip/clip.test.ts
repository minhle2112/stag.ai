import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePluginManifest } from '@shared/plugins'
import { forkWorker, PluginHost, type PluginHostApi } from '../plugins'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as T from '../../../resources/plugin-catalog/stag-plugin-clip/lib/transcript.mjs'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as S from '../../../resources/plugin-catalog/stag-plugin-clip/lib/source.mjs'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as St from '../../../resources/plugin-catalog/stag-plugin-clip/lib/store.mjs'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as Tl from '../../../resources/plugin-catalog/stag-plugin-clip/lib/tools.mjs'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as Sg from '../../../resources/plugin-catalog/stag-plugin-clip/lib/signals.mjs'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import * as Ct from '../../../resources/plugin-catalog/stag-plugin-clip/lib/cut.mjs'

type Sentence = { start: number; end: number; text: string }

const JSON3 = {
  events: [
    { tStartMs: 0, dDurationMs: 60000, id: 1 },
    {
      tStartMs: 9080,
      dDurationMs: 3439,
      segs: [{ utf8: 'Xin' }, { utf8: ' chào', tOffsetMs: 200 }, { utf8: ' mọi', tOffsetMs: 400 }, { utf8: ' người.', tOffsetMs: 600 }, { utf8: ' Hôm', tOffsetMs: 1000 }, { utf8: ' nay', tOffsetMs: 1200 }]
    },
    { tStartMs: 10629, dDurationMs: 1890, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 10639, dDurationMs: 4200, segs: [{ utf8: 'mình' }, { utf8: ' kể', tOffsetMs: 300 }, { utf8: ' chuyện.', tOffsetMs: 600 }] },
    // a long pause, then speech without punctuation
    { tStartMs: 20000, dDurationMs: 2000, segs: [{ utf8: 'nhạc' }, { utf8: ' dạo', tOffsetMs: 400 }] }
  ]
}

// YouTube auto VTT: cues start with a " " line, words carry inline times, every other cue repeats the last line.
const AUTO_VTT = `WEBVTT
Kind: captions
Language: vi

00:00:09.080 --> 00:00:10.629 align:start position:0%

Xin<00:00:09.280><c> chào</c><00:00:09.480><c> mọi</c><00:00:09.679><c> người.</c>

00:00:10.629 --> 00:00:10.639 align:start position:0%
Xin chào mọi người.


00:00:10.639 --> 00:00:12.509 align:start position:0%
Xin chào mọi người.
Hôm<00:00:11.160><c> nay</c><00:00:11.360><c> vui.</c>
`

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there, this is the first line

2
00:00:03,500 --> 00:00:06,000
and it ends here. Then a second one.

3
00:00:10,000 --> 00:00:12,000
<i>Third</i> &amp; last!
`

const tmps: string[] = []
const mkTmp = async (): Promise<string> => {
  const d = await fs.mkdtemp(join(tmpdir(), 'stag-clip-'))
  tmps.push(d)
  return d
}
afterEach(async () => {
  for (const d of tmps.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => {})
})

describe('transcript parsing', () => {
  it('json3: word timings → sentences ended by punctuation or a pause', () => {
    const s: Sentence[] = T.parseTranscript(JSON.stringify(JSON3), 'json3')
    expect(s.map((x) => x.text)).toEqual(['Xin chào mọi người.', 'Hôm nay mình kể chuyện.', 'nhạc dạo'])
    expect(s[0].start).toBe(9.08)
    expect(s[1].start).toBeCloseTo(10.08, 1)
    // the last word of a line never runs on through the silence after it
    expect(s[1].end).toBeLessThan(13)
    expect(s[2].start).toBe(20)
  })

  it('YouTube auto VTT: keeps the first line (cue starts with " "), drops the repeated lines', () => {
    const s: Sentence[] = T.parseTranscript(AUTO_VTT, 'vtt')
    expect(s.map((x) => x.text)).toEqual(['Xin chào mọi người.', 'Hôm nay vui.'])
    expect(s[0].start).toBe(9.08)
    expect(s[1].start).toBe(10.64)
  })

  it('SRT: cues merge until punctuation, multi-sentence cues split, tags and entities cleaned', () => {
    const s: Sentence[] = T.parseTranscript(SRT, '.srt')
    expect(s.map((x) => x.text)).toEqual(['Hello there, this is the first line and it ends here.', 'Then a second one.', 'Third & last!'])
    expect(s[0].start).toBe(1)
    expect(s[1].end).toBe(6)
    expect(s[2].start).toBe(10)
  })

  it('rolling plain VTT cues are de-duplicated', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne two\n\n00:00:02.000 --> 00:00:03.000\nOne two three four.\n'
    expect(T.parseTranscript(vtt, 'vtt').map((x: Sentence) => x.text)).toEqual(['One two three four.'])
  })

  it('times: read and format', () => {
    expect(T.readTime('1:02:05')).toBe(3725)
    expect(T.readTime('62:05')).toBe(3725)
    expect(T.readTime('125.5')).toBe(125.5)
    expect(T.readTime(90)).toBe(90)
    expect(Number.isNaN(T.readTime('abc'))).toBe(true)
    expect(T.fmtTime(3725.9)).toBe('1:02:05')
    expect(T.fmtTime(65)).toBe('1:05')
    expect(T.parseTime('00:01:02,500')).toBe(62.5)
  })
})

describe('transcript pages and cut snapping', () => {
  const sentences: Sentence[] = Array.from({ length: 200 }, (_, i) => ({ start: i * 10, end: i * 10 + 8, text: `Sentence number ${i} with a few words.` }))

  it('pages by time range and character budget, with where the next page starts', () => {
    const p = T.transcriptPage(sentences, 0, Infinity, 500)
    expect(p.text.split('\n')[0]).toBe('[0:00] Sentence number 0 with a few words.')
    expect(p.text.length).toBeLessThanOrEqual(500)
    expect(p.next).toBeGreaterThan(0)
    const q = T.transcriptPage(sentences, 1000, 1100)
    expect(q.text.split('\n')).toHaveLength(10)
    expect(q.next).toBeNull()
  })

  it('snaps start to the sentence start and end to the sentence end (± slack), with a little air', () => {
    expect(T.snapCut(sentences, 103, 146, { duration: 2000 })).toEqual({ start: 99.75, end: 148.4 })
    // nothing near: keeps the times
    expect(T.snapCut([], 50, 60, { duration: 2000 })).toEqual({ start: 49.75, end: 60.4 })
    // never past the video's end
    expect(T.snapCut(sentences, 1990, 1999, { duration: 1998 }).end).toBe(1998)
  })
})

describe('sources', () => {
  it('picks creator subtitles in the wanted language, then auto captions in the original language', () => {
    const info = {
      language: 'vi',
      subtitles: { en: [{ ext: 'json3', name: 'English' }], live_chat: [{ ext: 'json' }] },
      automatic_captions: { 'vi-orig': [{ ext: 'json3' }, { ext: 'vtt' }], en: [{ ext: 'json3' }], fr: [{ ext: 'json3' }] }
    }
    const subs = S.subtitleList(info)
    expect(subs.map((x: { kind: string; key: string }) => `${x.kind}:${x.key}`)).toEqual(['creator:en', 'auto:vi-orig'])
    expect(S.chooseSubtitle(subs, 'vi').key).toBe('vi-orig')
    expect(S.chooseSubtitle(subs, 'en').key).toBe('en')
    expect(S.chooseSubtitle(subs, null).key).toBe('en')
    expect(S.chooseSubtitle([], 'vi')).toBeNull()
    // preferred languages (Settings) come after the asked / video language
    const many = [
      { lang: 'de', key: 'de', kind: 'creator' },
      { lang: 'en', key: 'en', kind: 'creator' },
      { lang: 'ja', key: 'ja-orig', kind: 'auto' }
    ]
    expect(S.chooseSubtitle(many, 'ja', ['en']).key).toBe('ja-orig')
    expect(S.chooseSubtitle(many, 'fr', ['en', 'de']).key).toBe('en')
    expect(S.chooseSubtitle(many, null, []).key).toBe('de')
  })

  it('page strings: Vietnamese and English have the same keys', async () => {
    // @ts-expect-error plugin kèm app viết bằng JS thuần
    const { KEYS } = await import('../../../resources/plugin-catalog/stag-plugin-clip/ui/i18n.js')
    expect([...KEYS.en].sort()).toEqual([...KEYS.vi].sort())
  })

  it('ids, inputs, platforms and error reasons', () => {
    expect(S.onlineId({ extractor_key: 'Youtube', id: 'S4hYyLebsAw' })).toMatch(/^youtube-s4hyylebsaw-[0-9a-f]{4}$/)
    expect(S.onlineId({ extractor_key: 'TwitchVod', id: 'v123' })).toBe('twitchvod-v123')
    expect(S.parseInput('https://youtu.be/x', 'C:/p')).toEqual({ kind: 'online', url: 'https://youtu.be/x' })
    expect(S.parseInput('youtube-abc-1234', 'C:/p')).toEqual({ kind: 'id', id: 'youtube-abc-1234' })
    expect(S.parseInput('talk.mp4', 'C:/p').kind).toBe('file')
    expect(S.platformOf('https://www.twitch.tv/videos/1')).toBe('Twitch')
    expect(S.platformOf('https://kick.com/x/videos/1')).toBe('Kick')
    expect(S.errorReason('ERROR: [youtube] x: Join this channel to get access to members-only content')).toBe('login')
    expect(S.errorReason('ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>')).toBe('network')
    expect(S.errorReason('ERROR: Video unavailable')).toBe('unavailable')
  })

  it('safe folder names keep Vietnamese letters and drop what Windows forbids', () => {
    expect(St.safeName('Tập 47: Chuyện "tuổi thơ"?')).toBe('Tập 47 Chuyện tuổi thơ')
    expect(St.safeName('CON')).toBe('video')
    expect(St.safeName('...')).toBe('video')
  })

  it('yt-dlp counts as outdated after 60 days', () => {
    expect(Tl.ytdlpOutdated('2026.08.19', new Date('2026-10-14'))).toBe(false)
    expect(Tl.ytdlpOutdated('2026.06.01', new Date('2026-10-14'))).toBe(true)
    expect(Tl.ytdlpOutdated('garbage')).toBe(false)
  })
})

describe('signals', () => {
  it('heatmap peaks skip the opening seconds, merge neighbours and give "top N %"', () => {
    const heat = Array.from({ length: 100 }, (_, i) => ({ start: i * 10, end: i * 10 + 10, value: i === 0 ? 1 : i === 40 || i === 41 ? 0.9 : i === 70 ? 0.6 : 0.1 }))
    const peaks = Sg.heatPeaks(heat, 2)
    expect(peaks.map((p: { start: number; end: number }) => [p.start, p.end])).toEqual([
      [400, 420],
      [700, 710]
    ])
    expect(peaks[0].top).toBe(2)
    expect(Sg.topPercent([1, 2, 3, 4], 4)).toBe(25)
  })

  it('chat replay: YouTube live_chat lines and Twitch rechat → buckets with laughs', () => {
    const yt = [
      { replayChatItemAction: { actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: 'hahaha' }] } } } } }], videoOffsetTimeMsec: '61000' } },
      { replayChatItemAction: { actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: 'hello' }] } } } } }], videoOffsetTimeMsec: '65000' } }
    ]
      .map((x) => JSON.stringify(x))
      .join('\n')
    const tw = JSON.stringify({ comments: [{ content_offset_seconds: 3, message: { body: 'KEKW' } }, { content_offset_seconds: 95, message: { body: 'gg' } }] })
    expect(Sg.parseChat(yt)).toEqual([
      { t: 61, text: 'hahaha' },
      { t: 65, text: 'hello' }
    ])
    const msgs = [...Sg.parseChat(yt), ...Sg.parseChat(tw)]
    expect(Sg.chatBuckets(msgs)).toEqual([
      { start: 0, count: 1, laughs: 1 },
      { start: 60, count: 2, laughs: 1 },
      { start: 90, count: 1, laughs: 0 }
    ])
    expect(Sg.chatPeaks(Sg.chatBuckets(msgs), 1)[0]).toMatchObject({ start: 60, end: 90, count: 2, laughs: 1 })
  })

  it('loudness: windows clearly louder than the median', () => {
    const out = ['frame:0 pts:0 pts_time:0', 'lavfi.astats.Overall.RMS_level=-30.5', 'frame:1 pts:40000 pts_time:5', 'lavfi.astats.Overall.RMS_level=-inf'].join('\n')
    expect(Sg.parseLoudness(out)).toEqual([
      { start: 0, rms: -30.5 },
      { start: 5, rms: -120 }
    ])
    const w = [-30, -31, -30, -18, -17, -30, -29, -30].map((rms, i) => ({ start: i * 5, rms }))
    expect(Sg.loudPeaks(w)).toEqual([{ start: 15, end: 25, db: 13 }])
  })

  it('the same moment twice is one clip', () => {
    const clips = [{ start: 100, end: 160 }]
    expect(Ct.sameMoment(clips, 102, 158)).toEqual(clips[0])
    expect(Ct.sameMoment(clips, 140, 200)).toBeNull()
  })
})

describe('manifest', () => {
  it('long-running tools get their own timeout; the page has a Lucide icon from the app set', async () => {
    const pkg = JSON.parse(await fs.readFile(resolve('resources/plugin-catalog/stag-plugin-clip/package.json'), 'utf8'))
    const { manifest } = parsePluginManifest(pkg)
    expect(manifest.icon).toBe('clip')
    expect(Object.fromEntries(manifest.tools.map((t) => [t.name, t.timeoutSec]))).toEqual({ clip_fetch: 600, clip_transcript: 300, clip_cut: 1800, clip_signals: 1200, clip_list: undefined })
    expect(parsePluginManifest({ stagPlugin: { ...pkg.stagPlugin, icon: 'Bad Icon!', tools: [{ ...pkg.stagPlugin.tools[0], timeoutSec: 99999 }] } }).manifest).toMatchObject({ tools: [{ timeoutSec: 1800 }] })
    expect(parsePluginManifest({ stagPlugin: { ...pkg.stagPlugin, icon: 'Bad Icon!' } }).manifest.icon).toBeUndefined()
  })
})

describe('worker (real process)', () => {
  let host: PluginHost | null = null
  afterEach(async () => {
    await host?.shutdown()
    host = null
  })

  it('clip_fetch / clip_transcript on a file with a sidecar .srt, through PluginHost', async () => {
    const ffprobe = await Tl.findTool('ffprobe')
    if (!ffprobe) return // ffprobe not installed on this machine: covered by the unit tests above
    const ffmpeg = await Tl.findTool('ffmpeg')
    const ws = await mkTmp()
    const root = await mkTmp()
    // a 12 s silent black video + its .srt
    const video = join(ws, 'talk.mp4')
    const { run } = Tl
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=12', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '12', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', video])
    await fs.writeFile(join(ws, 'talk.srt'), SRT, 'utf8')
    const asked: Array<[string, string, string]> = []
    const published: Array<[string, string, { file: string; title: string; description: string }]> = []
    const api: PluginHostApi = {
      agents: () => ({
        workspaces: [{ id: 'w1', name: 'W', path: ws }],
        agents: [{ id: 'a1', name: 'Lead', role: '', kind: 'claude', workspaceId: 'w1', running: true, activity: null }]
      }),
      sendToAgent: async () => {},
      board: async () => [],
      vaultRead: async () => null,
      vaultWrite: async () => {},
      workspacePaths: () => ({ path: ws, vaultPath: join(ws, 'vault') }),
      notify: () => {},
      askAgent: async (agentId, text, from) => {
        asked.push([agentId, text, from])
        return 'queued'
      },
      publishArtifact: async (workspaceId, agentId, input) => {
        published.push([workspaceId, agentId, input])
        return 'a7'
      }
    }
    host = new PluginHost(root, { spawn: forkWorker, api, catalogDir: resolve('resources/plugin-catalog') })
    await host.load()
    await host.install({ type: 'catalog', slug: 'stag-plugin-clip' })
    await host.approve('stag.clip')
    const tools = host.toolsFor('w1', 'a1').map((x) => x.tool.name)
    expect(tools).toEqual(['clip_fetch', 'clip_transcript', 'clip_cut', 'clip_signals', 'clip_list'])
    const ctx = { workspaceId: 'w1', workspacePath: ws, projectPath: ws, agentId: 'a1', agentName: 'Lead' }
    const f = await host.callTool('stag.clip', 'clip_fetch', { source: 'talk.mp4' }, ctx)
    expect(f.isError).toBe(false)
    expect(f.text).toMatch(/Transcript: und \(subtitle file next to the video\), 3 sentences/)
    const id = /Source (file-[0-9a-f]+)/.exec(f.text)?.[1]
    const t = await host.callTool('stag.clip', 'clip_transcript', { source: id, from: '0:05' }, ctx)
    expect(t.text).toContain('[0:04] Then a second one.')
    expect(t.text).toContain('[0:10] Third & last!')
    expect(t.text).toContain('End of transcript')
    if (ffmpeg) {
      const c = await host.callTool('stag.clip', 'clip_cut', { source: id, start: 2, end: 5, title: 'Mở đầu', reason: 'test' }, ctx)
      expect(c.isError).toBe(false)
      expect(c.text).toMatch(/Cut clip 1 of file-/)
      const files = await fs.readdir(join(ws, 'clips', 'talk'))
      expect(files.some((x) => x.endsWith('.mp4'))).toBe(true)
      const l = await host.callTool('stag.clip', 'clip_list', { source: id }, ctx)
      expect(l.text).toMatch(/^1\. 0:00–0:06 "Mở đầu" — waiting for the user$/)
      // the same moment again is refused, not cut twice
      const again = await host.callTool('stag.clip', 'clip_cut', { source: id, start: 2.5, end: 5, title: 'Lặp', reason: 'x' }, ctx)
      expect(again.text).toMatch(/^Not cut: clip 1 /)
      // page: keep → published to Artifacts under the agent that cut it
      const page = { workspaceId: 'w1', workspaceName: 'W', workspacePath: ws }
      const { clips } = (await host.bridge('stag.clip', 'data.get', { key: 'source', params: { id } }, page)) as { clips: Array<{ id: string; rel: string }> }
      expect(clips).toHaveLength(1)
      const d = (await host.bridge('stag.clip', 'action.perform', { key: 'decide', params: { sourceId: id, clipIds: [clips[0].id], state: 'kept' } }, page)) as { failed: unknown[] }
      expect(d.failed).toEqual([])
      expect(published).toEqual([['w1', 'a1', { file: clips[0].rel, title: 'Mở đầu', description: expect.stringContaining('test') }]])
      const after = (await host.bridge('stag.clip', 'data.get', { key: 'source', params: { id } }, page)) as { clips: Array<{ state: string; artifactId?: string }> }
      expect(after.clips[0]).toMatchObject({ state: 'kept', artifactId: 'a7' })
    }
    // page: ask bar → the agent gets an English request with the user's words
    const r = await host.bridge('stag.clip', 'action.perform', { key: 'ask', params: { sourceId: id, query: 'đoạn hài nhất', length: '30-60', count: 3, agentId: 'a1', locale: 'vi' } }, { workspaceId: 'w1', workspacePath: ws })
    expect(r).toEqual({ status: 'queued' })
    expect(asked).toHaveLength(1)
    expect(asked[0][0]).toBe('a1')
    expect(asked[0][2]).toBe('Stag Clip')
    expect(asked[0][1]).toContain('Find the 3 best moments')
    expect(asked[0][1]).toContain('"đoạn hài nhất"')
    expect(asked[0][1]).toContain('Each clip 30 s–1 min')
    expect(asked[0][1]).toContain('in Vietnamese')
  }, 60_000)
})
