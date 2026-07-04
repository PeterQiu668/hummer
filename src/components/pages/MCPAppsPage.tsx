/**
 * MCP 应用 — 企业系统连接
 */
import { useState } from 'react';
import { Search, Plug, Settings2, Activity, Plus, RefreshCw } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { useAppStore } from '../../store/useAppStore';

const APP_ICONS: Record<string, string> = {
  feishu: '🟦', wework: '🟩', wechat: '💬', notion: '📓',
  github: '⬛', gdrive: '🟨', slack: '🟪', postgres: '🐘',
  salesforce: '☁️', mail: '📧', chrome: '🌐', kingdee: '🟧',
};

const APP_TOOLS: Record<string, string[]> = {
  feishu:     ['feishu.docs.read', 'feishu.docs.write', 'feishu.approval.create', 'feishu.calendar.read'],
  wework:     ['wework.message.send', 'wework.contact.read'],
  wechat:     ['wechat.message.send', 'wechat.contact.read'],
  notion:     ['notion.page.read', 'notion.page.write', 'notion.search'],
  github:     ['gitlab.repo.read', 'gitlab.repo.write', 'gitlab.pr.create'],
  gdrive:     ['drive.file.read', 'drive.file.write'],
  slack:      ['slack.message.send', 'slack.channel.list'],
  postgres:   ['db.query', 'db.write'],
  salesforce: ['crm.contact.search', 'crm.opportunity.update'],
  mail:       ['mail.send', 'mail.read'],
  chrome:     ['browser.navigate', 'browser.click', 'browser.read'],
  kingdee:    ['erp.kingdee.queryBalance', 'erp.kingdee.transfer'],
};

export default function MCPAppsPage() {
  const [q, setQ] = useState('');
  const mcpApps = useAppStore((s) => s.mcpApps);
  const toggleMCP = useAppStore((s) => s.toggleMCP);
  const pushToast = useAppStore((s) => s.pushToast);
  const [detail, setDetail] = useState<string | null>(null);

  const apps = Object.values(mcpApps).filter(
    (a) => q === '' || a.name.includes(q) || a.kind.includes(q),
  );

  const connected = apps.filter((a) => a.connected).length;

  return (
    <WorkspacePage
      title="MCP 应用"
      sub={`${connected} / ${apps.length} 个企业系统已连接 · Agent 通过 MCP 调用工具，凭证统一托管`}
      actions={
        <>
          <button className="hum-btn is-sm">
            <RefreshCw size={12} /> 全部刷新
          </button>
          <button className="hum-btn is-sm is-primary">
            <Plus size={12} /> 添加 MCP Server
          </button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索应用 / 类型…"
              className="hum-input pl-7"
            />
          </div>
          <span className="hum-chip is-success">{connected} 已连接</span>
          <span className="hum-chip is-muted">{apps.length - connected} 未连接</span>
        </div>
      }
    >
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {apps.map((a) => {
          const tools = APP_TOOLS[a.id] ?? [];
          return (
            <div key={a.id} className="hum-card p-3 hover:hum-elev-2 transition">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-neutral-100 grid place-items-center text-xl">
                  {APP_ICONS[a.id] ?? '🔌'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-neutral-900">{a.name}</div>
                  <div className="text-[11px] hum-faint">{a.kind}</div>
                </div>
                <span className={a.connected ? 'hum-chip is-success' : 'hum-chip is-muted'} style={{ padding: '1px 6px', fontSize: 10 }}>
                  <span className={`hum-dot ${a.connected ? 'hum-pulse' : ''}`} style={{ background: a.connected ? 'var(--success)' : 'var(--text-faint)' }} />
                  {a.connected ? '已连接' : '未连接'}
                </span>
              </div>

              <div className="text-[11px] hum-muted mt-2.5 font-mono">
                {a.connected ? `最近同步：${a.syncedAt}` : '点击 「连接」 完成 OAuth 授权'}
              </div>

              {tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tools.slice(0, 4).map((t) => (
                    <code key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                      {t}
                    </code>
                  ))}
                  {tools.length > 4 && <span className="text-[10px] hum-faint">+{tools.length - 4}</span>}
                </div>
              )}

              <div className="mt-3 pt-3 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={() => setDetail(a.id)} className="hum-btn is-sm">
                  <Settings2 size={11} /> 配置
                </button>
                <button className="hum-btn is-sm">
                  <Activity size={11} /> 日志
                </button>
                <button
                  onClick={() => {
                    toggleMCP(a.id);
                    pushToast({
                      kind: a.connected ? 'info' : 'success',
                      title: `${a.name} ${a.connected ? '已断开' : '已连接'}`,
                      detail: a.connected ? undefined : `${tools.length} 个工具可被 Agent 调用`,
                    });
                  }}
                  className={`hum-btn is-sm ml-auto ${a.connected ? 'is-danger' : 'is-primary'}`}
                >
                  <Plug size={11} /> {a.connected ? '断开' : '连接'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <MCPDetail
          app={mcpApps[detail]}
          tools={APP_TOOLS[detail] ?? []}
          onClose={() => setDetail(null)}
        />
      )}
    </WorkspacePage>
  );
}

function MCPDetail({ app, tools, onClose }: { app: any; tools: string[]; onClose: () => void }) {
  return (
    <div className="absolute top-0 right-0 bottom-0 w-[440px] z-40 bg-white flex flex-col"
      style={{ borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-modal)' }}>
      <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="w-10 h-10 rounded-lg bg-neutral-100 grid place-items-center text-xl">
          {APP_ICONS[app.id]}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-semibold text-neutral-900">{app.name}</h2>
          <div className="text-[11px] hum-muted">{app.kind} · {app.connected ? '已连接' : '未连接'}</div>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <div className="hum-eyebrow mb-1.5">权限范围</div>
          <div className="hum-card-soft p-3 space-y-1.5">
            {['读取数据', '写入数据', '触发自动化'].map((perm) => (
              <label key={perm} className="flex items-center gap-2 text-[12.5px] text-neutral-700 cursor-pointer">
                <input type="checkbox" defaultChecked={perm !== '触发自动化'} className="rounded" />
                {perm}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="hum-eyebrow mb-1.5">暴露给 Agent 的工具（{tools.length}）</div>
          <div className="space-y-1">
            {tools.map((t) => (
              <div key={t} className="flex items-center justify-between hum-card-soft px-2 py-1.5">
                <code className="text-[11.5px] font-mono text-neutral-700">{t}</code>
                <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>启用</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
