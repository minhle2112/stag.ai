import { emptyConnector, oauthSecretName, secretNameFor } from '@shared/connectors'
import { fillServerUrl, findCatalog } from '@shared/catalog'
import type { ConnectAccess, ConnectRequest, Connector } from '@shared/types'
import type { OAuthService } from './oauth'
import type { SecretStore } from './secrets'
import type { SettingsStore } from './settings'
import { t } from '@shared/i18n'

/**
 * "Connect" từ danh mục: dựng connector theo cách kết nối đã chọn, cất key / đăng nhập OAuth, lưu, rồi bật cho
 * đúng những agent người dùng chọn ở bước 1. Trả về id connector (thử kết nối do người gọi làm tiếp).
 */
export async function connectFromCatalog(req: ConnectRequest, deps: { settings: SettingsStore; secrets: SecretStore; oauth: OAuthService }): Promise<string> {
  const found = findCatalog(req.slug, req.method)
  if (!found) throw new Error(t('connectors.connect.notFound'))
  const { entry, method: m } = found
  const items = deps.settings.get().app.connectors.items
  let id = entry.slug
  for (let i = 2; items.some((c) => c.id === id); i++) id = `${entry.slug}-${i}`

  const c: Connector = { ...emptyConnector(id), label: items.some((x) => x.label === entry.name) ? `${entry.name} (${id})` : entry.name, catalog: { slug: entry.slug, method: m.key } }
  const secrets: Array<{ name: string; value: string }> = []
  if (m.kind === 'stdio') {
    c.command = m.command ?? ''
    c.args = m.args ?? []
  } else {
    c.transport = 'http'
    if (m.kind === 'url') {
      const url = (req.value ?? '').trim()
      let u: URL
      try {
        u = new URL(url)
      } catch {
        throw new Error(t('connectors.connect.pasteUrl'))
      }
      if (u.protocol !== 'https:') throw new Error(t('connectors.connect.https'))
      // Token nằm trong URL: cất cả URL thành bí mật, cài đặt chỉ giữ bản rút gọn để hiện.
      const name = secretNameFor(id, 'URL')
      secrets.push({ name, value: url })
      c.urlSecret = name
      c.url = `${u.origin}/…`
    } else c.url = fillServerUrl(m, req.fields ?? {})
    if (m.kind === 'key') {
      const value = (req.value ?? '').trim()
      if (!value) throw new Error(t('connectors.connect.keyRequired', { label: m.keyLabel ?? 'API key' }))
      const name = secretNameFor(id, 'KEY')
      secrets.push({ name, value })
      const h = m.header ?? { name: 'Authorization', prefix: 'Bearer ' }
      if (h.name.toLowerCase() === 'authorization' && h.prefix === 'Bearer ') c.bearerSecret = name
      else c.headers[h.name] = h.prefix ? { secret: name, prefix: h.prefix } : { secret: name }
    }
  }
  if (secrets.length) await deps.secrets.setMany(secrets)
  if (m.kind === 'oauth' || m.kind === 'oauth-app') {
    const name = oauthSecretName(id)
    await deps.oauth.login(name, {
      serverUrl: c.url,
      // OAuth app riêng: bỏ trống Client ID thì thử tự đăng ký (vd. Linear cho phép dù danh mục ghi cần app riêng).
      client: m.kind === 'oauth-app' && req.client?.id.trim() ? { id: req.client.id.trim(), secret: (req.client.secret ?? '').trim() } : undefined,
      endpoints: m.oauth,
      scopes: m.oauth?.scopes,
      params: m.oauth?.params
    })
    c.oauth = true
    c.bearerSecret = name
  }
  c.enabled = req.access.mode === 'all'
  await deps.settings.addConnectors([c])
  await grant(deps.settings, id, req.access)
  return id
}

async function grant(settings: SettingsStore, id: string, access: ConnectAccess): Promise<void> {
  const s = settings.get()
  if (access.mode === 'workspace') {
    await settings.setOverrides('workspace', access.workspaceId, { connectors: { ...s.workspaces[access.workspaceId]?.connectors, [id]: true } })
  } else if (access.mode === 'agents') {
    for (const agentId of access.agentIds) {
      await settings.setOverrides('agent', agentId, { connectors: { ...settings.get().agents[agentId]?.connectors, [id]: true } })
    }
  }
}
