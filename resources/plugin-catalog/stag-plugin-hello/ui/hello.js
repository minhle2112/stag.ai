// The "Hello" page (page slot). The page SDK is served by the app at /__stag/ui.js.
import { host } from '/__stag/ui.js'

const $ = (id) => document.getElementById(id)

function renderPing(ping) {
  $('ping').textContent = ping ? `${new Date(ping.at).toLocaleString()}\n${JSON.stringify(ping.body, null, 2)}` : 'Nothing received yet.'
  $('ping').classList.toggle('muted', !ping)
}

async function load() {
  const ctx = host.context
  $('ws').textContent = ctx?.workspace ? `· ${ctx.workspace.name}` : ''
  try {
    const stats = await host.getData('stats')
    $('agents').innerHTML = ''
    for (const a of stats.agents) {
      const tr = document.createElement('tr')
      for (const v of [a.name, a.running ? 'yes' : '—', String(a.done)]) {
        const td = document.createElement('td')
        td.textContent = v
        tr.append(td)
      }
      $('agents').append(tr)
    }
    if (!stats.agents.length) $('agents').innerHTML = '<tr><td colspan="3" class="muted">This workspace has no agents yet.</td></tr>'
    $('summary').textContent = stats.lastSummary ? `Last summary (${new Date(stats.lastSummary.at).toLocaleTimeString()}): ${stats.lastSummary.text}` : ''
    renderPing(stats.lastPing)
  } catch (e) {
    $('agents').innerHTML = ''
    const tr = document.createElement('tr')
    tr.innerHTML = '<td colspan="3"></td>'
    tr.firstChild.textContent = `Error: ${e.message}`
    $('agents').append(tr)
  }
}

$('hello').addEventListener('click', async () => {
  const r = await host.action('hello')
  await host.toast(r.message)
})

await host.ready
host.onContext(load)
host.on('stats', load)
host.on('ping', renderPing)
await load()
