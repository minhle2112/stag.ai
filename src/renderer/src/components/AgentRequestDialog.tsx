import type { ReactNode } from 'react'
import type { AgentCreateDraft, AgentRequest } from '@shared/agentApi'
import type { AgentKind } from '@shared/types'
import { useAgentRequests } from '../store/agentRequests'
import { useAgents } from '../store/agents'
import { useWorkspaces } from '../store/workspaces'
import { permissionModes } from '../permissionModes'
import { Button, Modal } from './Modal'

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <>
      <div className="text-dim">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </>
  )
}

function Grid({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mt-3 grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 rounded-md border border-line bg-bg p-2.5 text-[12px]">{children}</div>
}

function Permission({ kind, mode }: { kind: AgentKind; mode: string }): React.JSX.Element {
  const perm = permissionModes(kind).find((p) => p.id === mode)
  return (
    <>
      <span className={mode === 'auto' ? 'font-semibold text-wait' : ''}>{perm?.label ?? mode}</span>
      {perm && <div className="text-[12px] text-muted">{perm.hint}</div>}
    </>
  )
}

function CreateBody({ d, fromName }: { d: AgentCreateDraft; fromName: string }): React.JSX.Element {
  const cli = d.kind === 'claude' || d.kind === 'codex'
  return (
    <Grid>
      <Row label="Tên">
        <b>{d.name}</b>
      </Row>
      <Row label="Loại">{d.kindLabel}</Row>
      {cli && <Row label="Model">{d.model ?? <span className="text-muted">mặc định</span>}</Row>}
      {cli && <Row label="Mức suy nghĩ">{d.effort ?? <span className="text-muted">mặc định</span>}</Row>}
      {cli && (
        <Row label="Quyền">
          <Permission kind={d.kind} mode={d.permissionMode} />
        </Row>
      )}
      {d.kind !== 'terminal' && <Row label="Vai trò">{d.role || <span className="text-muted">(không có)</span>}</Row>}
      {d.kind !== 'terminal' && (
        <Row label="Việc đầu tiên">
          {d.task ? (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{d.task}</div>
          ) : (
            <span className="text-muted">(không có — agent mới chào và hỏi bạn)</span>
          )}
        </Row>
      )}
      <Row label="Mở ngay">{d.open ? `Có — thêm ô cạnh ô của ${fromName} và chạy phiên` : 'Không — chỉ thêm vào danh sách agent'}</Row>
    </Grid>
  )
}

/** Tiêu đề, câu hỏi, nút đồng ý theo loại yêu cầu. */
function view(req: AgentRequest, kindOf: (id: string) => AgentKind): { title: string; lead: ReactNode; body: ReactNode; ok: string } {
  const from = <b>{req.fromName}</b>
  switch (req.action) {
    case 'create':
      return {
        title: 'Agent muốn tạo agent mới',
        lead: (
          <>
            Agent {from} muốn tạo {req.create.kind === 'terminal' ? 'một ô terminal' : 'một agent'} mới
          </>
        ),
        body: <CreateBody d={req.create} fromName={req.fromName} />,
        ok: 'Tạo agent'
      }
    case 'stop':
      return {
        title: 'Agent muốn dừng phiên của agent khác',
        lead: (
          <>
            Agent {from} muốn dừng phiên đang chạy của <b>{req.target.name}</b> ({req.target.kindLabel})
          </>
        ),
        body: <p className="mt-3 text-[13px]">Việc đang mở của {req.target.name} (nếu có) vẫn giữ; mở lại phiên sau được.</p>,
        ok: 'Dừng phiên'
      }
    case 'delete':
      return {
        title: 'Agent muốn xoá agent khác',
        lead: (
          <>
            Agent {from} muốn xoá agent <b>{req.target.name}</b> ({req.target.kindLabel})
          </>
        ),
        body: (
          <p className="mt-3 text-[13px]">
            {req.target.running ? 'Phiên đang chạy sẽ bị dừng, ' : ''}note bộ nhớ của {req.target.name} chuyển vào Thùng rác (khôi phục được), thẻ việc đang dở bị bỏ.
          </p>
        ),
        ok: 'Xoá agent'
      }
    case 'permission':
      return {
        title: 'Agent muốn đổi quyền của agent',
        lead: (
          <>
            Agent {from} muốn đổi quyền của <b>{req.target.name}</b> ({req.target.kindLabel})
          </>
        ),
        body: (
          <Grid>
            <Row label="Hiện tại">
              <Permission kind={kindOf(req.target.id)} mode={req.from} />
            </Row>
            <Row label="Đổi thành">
              <Permission kind={kindOf(req.target.id)} mode={req.to} />
            </Row>
            <Row label="Có tác dụng">{req.target.running ? 'Từ phiên sau (phiên đang chạy giữ quyền cũ)' : 'Từ phiên tới'}</Row>
          </Grid>
        ),
        ok: 'Đổi quyền'
      }
    case 'devserver':
      return {
        title: 'Agent muốn chạy dev server',
        lead: (
          <>
            Agent {from} muốn chạy dev server <b>{req.dev.name}</b> trong một ô terminal
          </>
        ),
        body: (
          <Grid>
            <Row label="Lệnh">
              <code className="whitespace-pre-wrap">{req.dev.command}</code>
            </Row>
            <Row label="Cổng">{req.dev.port}</Row>
            <Row label="Nguồn">
              {req.dev.source === 'agent'
                ? 'Agent tự đưa lệnh này (sẽ lưu vào .stag/launch.json)'
                : req.dev.source === 'saved'
                  ? 'Lấy từ .stag/launch.json của dự án'
                  : 'App đoán từ package.json của dự án'}
            </Row>
            <Row label="Lưu ý">Lệnh chạy ngoài chế độ quyền của agent, với quyền của bạn. Đồng ý một lần thì lệnh này chạy lại được tới khi tắt app.</Row>
          </Grid>
        ),
        ok: 'Chạy lệnh'
      }
    case 'drive': {
      const verb = req.tool === 'send' ? 'gửi tin cho' : req.tool === 'open' ? 'mở phiên và giao việc cho' : 'bàn giao việc cho'
      return {
        title: 'Agent quyền thấp muốn sai agent quyền cao hơn',
        lead: (
          <>
            Agent {from} muốn {verb} <b>{req.target.name}</b> ({req.target.kindLabel})
          </>
        ),
        body: (
          <Grid>
            <Row label={`Quyền ${req.fromName}`}>
              <Permission kind={kindOf(req.fromAgentId)} mode={req.from} />
            </Row>
            <Row label={`Quyền ${req.target.name}`}>
              <Permission kind={kindOf(req.target.id)} mode={req.to} />
            </Row>
            <Row label="Nội dung">
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{req.text}</div>
            </Row>
          </Grid>
        ),
        ok: req.tool === 'send' ? 'Gửi' : req.tool === 'open' ? 'Mở và giao việc' : 'Bàn giao'
      }
    }
  }
}

/**
 * Agent xin làm thay bạn một việc trên app (Agent API: tạo / dừng / xoá agent, đổi quyền): hỏi bạn trước (hộp thoại
 * đầu hàng đợi). Agent đang chờ câu trả lời; hết hạn thì main tự từ chối.
 */
export function AgentRequestDialog(): React.JSX.Element | null {
  const req = useAgentRequests((s) => s.list[0])
  const answer = useAgentRequests((s) => s.answer)
  const wsName = useWorkspaces((s) => s.items.find((w) => w.id === req?.workspaceId)?.name)
  const agents = useAgents((s) => (req ? s.byWs[req.workspaceId]?.agents : undefined))
  if (!req) return null
  const kindOf = (id: string): AgentKind => agents?.find((a) => a.id === id)?.kind ?? 'claude'
  const v = view(req, kindOf)
  const minutes = Math.max(1, Math.round((Date.parse(req.until) - Date.now()) / 60_000))
  return (
    <Modal
      title={v.title}
      icon="code"
      tone="accent"
      width="w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(req.id, false)}>
            Từ chối
          </Button>
          <Button primary onClick={() => answer(req.id, true)}>
            {v.ok}
          </Button>
        </>
      }
    >
      <p>
        {v.lead}
        {wsName ? (
          <>
            {' '}
            trong workspace <b>{wsName}</b>
          </>
        ) : null}
        :
      </p>
      {v.body}
      <p className="mt-3 text-[12px] text-muted">
        Chỉ đồng ý nếu chính bạn đã nhờ {req.fromName} làm việc này. {req.fromName} đang chờ bạn trả lời (tự từ chối sau khoảng {minutes} phút).
      </p>
    </Modal>
  )
}
