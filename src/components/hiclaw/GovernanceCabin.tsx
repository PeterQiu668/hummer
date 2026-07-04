/**
 * 审计与治理 (前身 HiClaw 治理舱)
 * 按 brief 第四条：理念融入，不做对标名栏目。文案+视觉都剔除 HiClaw 字样。
 * 涵盖：租户/部门、AI Gateway、Skill/MCP Hub、风险热力、审计快照。
 */
import { motion } from 'framer-motion';
import {
  X, Shield, Users, Key, Cpu, Activity, AlertTriangle, Cable, Building2,
  CheckCircle2, BadgeCheck,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';

const departments = [
  { name: '决策中心',       headcount: 1, model: 'Opus 4.7',  cost: '¥124' },
  { name: '业务办公区',     headcount: 5, model: 'Mixed',     cost: '¥210' },
  { name: '行政支持中心',   headcount: 3, model: 'Haiku 4.5', cost: '¥78' },
  { name: '会议室',         headcount: 1, model: 'Opus 4.7',  cost: '¥43' },
  { name: '休息区',         headcount: 1, model: 'Sonnet 4.6',cost: '¥19' },
  { name: '学习训练区',     headcount: 1, model: 'Sandbox',   cost: '¥30' },
];

const aiGateway = [
  { name: 'Claude Opus 4.7',     tpm: '1.4M / 2M', latency: '820ms', status: 'green' },
  { name: 'Claude Sonnet 4.6',   tpm: '3.1M / 5M', latency: '320ms', status: 'green' },
  { name: 'Claude Haiku 4.5',    tpm: '4.2M / 8M', latency: '140ms', status: 'green' },
  { name: '本地推理 (Sandbox)',   tpm: '380K / 1M', latency: '90ms',  status: 'green' },
  { name: 'DeepSeek-V3 (备用)',  tpm: '120K / 1M', latency: '410ms', status: 'amber' },
];

const skillHub = [
  { name: 'BD 邮件 v3.2',     author: '陈若澜 共创',   signed: true,  version: 'v3.2',         hires: 1284, risk: 'low' },
  { name: '618 复盘 v4.1',    author: '韩书白 共创',   signed: true,  version: 'v4.1',         hires: 1782, risk: 'low' },
  { name: '合同审阅 v2.7',    author: '周明衡 共创',   signed: true,  version: 'v2.7',         hires: 712,  risk: 'medium' },
  { name: '资金调拨 v3 → v4', author: '系统自动进化',  signed: false, version: 'v4 (sandbox)', hires: 0,    risk: 'medium' },
];

const mcpHub = [
  { name: 'crm.salesforce',   kind: 'CRM',       status: 'green' },
  { name: 'erp.kingdee',       kind: 'ERP',       status: 'green' },
  { name: 'feishu.docs',       kind: '飞书文档',  status: 'green' },
  { name: 'feishu.approval',   kind: '飞书审批',  status: 'green' },
  { name: 'wework.message',    kind: '企业微信',  status: 'green' },
  { name: 'gitlab.repo',       kind: 'GitLab',    status: 'green' },
  { name: 'bi.warehouse',      kind: '数仓',      status: 'green' },
  { name: 'kg.enterprise',     kind: '知识图谱',  status: 'green' },
  { name: 'mail.exchange',     kind: '邮件外发',  status: 'amber' },
];

const riskHeat: ('low' | 'medium' | 'high')[][] = [
  ['low', 'low', 'low', 'medium', 'low', 'low'],
  ['low', 'low', 'low', 'low', 'low', 'low'],
  ['low', 'medium', 'high', 'low', 'low', 'low'],
  ['low', 'low', 'low', 'low', 'low', 'medium'],
  ['low', 'low', 'low', 'low', 'low', 'low'],
];

const RISK_COLOR = { low: '#1E8F5C', medium: '#B07706', high: '#C13D3D' };

export default function GovernanceCabin() {
  const setShowGovernance = useAppStore((s) => s.setShowGovernance);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
      onClick={() => setShowGovernance(false)}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="m-6 flex-1 bg-white rounded-xl overflow-hidden flex flex-col"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-10 h-10 rounded-lg bg-primary-50 grid place-items-center">
            <Shield size={18} className="text-primary-700" />
          </div>
          <div className="flex-1">
            <h1 className="hum-h1 text-[20px]">审计与治理</h1>
            <p className="text-[12px] hum-muted mt-0.5">
              多租户 / 凭证统一托管 / 模型路由 / 工具网关 / 风险热力 / 审计账本
            </p>
          </div>
          <span className="hum-chip is-success">
            <CheckCircle2 size={11} /> 全部正常
          </span>
          <button onClick={() => setShowGovernance(false)} className="text-neutral-400 hover:text-neutral-900">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-4">
          {/* Tenant */}
          <Card span={4} icon={<Building2 size={14} />} title="租户 · 部门 · 角色">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <KV label="租户" value="蓝血军团" />
              <KV label="部门" value={`${departments.length}`} />
              <KV label="员工" value={`${employees.length}`} />
            </div>
            <div className="space-y-1">
              {departments.map((d) => (
                <div key={d.name} className="flex items-center gap-2 px-2 py-1.5 hum-card-soft">
                  <Users size={11} className="text-primary-600" />
                  <span className="flex-1 text-[12px] text-neutral-700">{d.name}</span>
                  <span className="text-[10.5px] hum-faint font-mono">{d.headcount} 人</span>
                  <span className="text-[10.5px] font-mono text-warning">{d.cost}/日</span>
                </div>
              ))}
            </div>
          </Card>

          {/* AI Gateway */}
          <Card span={4} icon={<Cpu size={14} />} title="模型路由 · AI Gateway">
            <div className="space-y-1.5">
              {aiGateway.map((g) => (
                <div key={g.name} className="hum-card-soft p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.status === 'green' ? 'var(--success)' : 'var(--warning)' }} />
                    <span className="text-[12px] text-neutral-900 flex-1">{g.name}</span>
                    <span className="text-[10px] hum-faint font-mono">{g.latency}</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full bg-primary-500"
                      style={{ width: `${(parseFloat(g.tpm) / parseFloat(g.tpm.split('/')[1])) * 100}%` }} />
                  </div>
                  <div className="text-[9.5px] font-mono hum-faint mt-0.5">{g.tpm} TPM</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10.5px] hum-faint flex items-center gap-1">
              <Key size={10} /> 凭证统一托管 · Agent 不持密钥
            </div>
          </Card>

          {/* Risk heat */}
          <Card span={4} icon={<AlertTriangle size={14} />} title="风险热力图">
            <div className="grid grid-cols-6 gap-1">
              {riskHeat.flat().map((r, i) => (
                <div key={i} className="aspect-square rounded"
                  style={{ background: `${RISK_COLOR[r]}1F`, border: `1px solid ${RISK_COLOR[r]}` }}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-neutral-600">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-success" />低</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-warning" />中</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-error" />高</span>
            </div>
            <div className="mt-3 hum-card-soft p-2.5" style={{ borderLeft: '3px solid var(--error)' }}>
              <div className="flex items-center gap-2 text-error text-[12px]">
                <AlertTriangle size={12} /> 1 起高危 · 财务 138w 调拨
              </div>
              <div className="text-[10.5px] hum-faint mt-1">已阻断 · 等待昆仑审批</div>
            </div>
          </Card>

          {/* Skill Hub */}
          <Card span={6} icon={<Cable size={14} />} title="Skill / MCP 仓库 · 签名与版本">
            <div className="space-y-1.5">
              {skillHub.map((s) => (
                <div key={s.name} className="hum-card-soft p-2.5 flex items-center gap-2">
                  {s.signed
                    ? <BadgeCheck size={13} className="text-success" />
                    : <AlertTriangle size={13} className="text-warning hum-pulse" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-neutral-900 truncate">{s.name}</div>
                    <div className="text-[10.5px] hum-faint">{s.author} · {s.version}</div>
                  </div>
                  <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, color: RISK_COLOR[s.risk as keyof typeof RISK_COLOR], borderColor: `${RISK_COLOR[s.risk as keyof typeof RISK_COLOR]}40`, background: 'transparent' }}>
                    {s.risk.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* MCP Hub */}
          <Card span={6} icon={<Cable size={14} />} title="MCP Servers · 企业接入">
            <div className="grid grid-cols-3 gap-1.5">
              {mcpHub.map((m) => (
                <div key={m.name} className="hum-card-soft p-2 flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full"
                    style={{ background: m.status === 'green' ? 'var(--success)' : 'var(--warning)' }} />
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-mono text-neutral-900 truncate">{m.name}</div>
                    <div className="text-[10px] hum-faint">{m.kind}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-[10.5px] hum-faint">
              对内：MCP 连接工具 / 数据 / 业务系统 · 对外：A2A 协议跨 Agent / 跨组织
            </div>
          </Card>

          {/* Audit snapshot */}
          <Card span={12} icon={<Activity size={14} />} title="审计快照 · Append-only">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                {[
                  { t: '14:35:12', who: '雪·销售官',       a: '生成 BD 邮件草稿', target: '鲲鹏制造',           r: 'low' },
                  { t: '14:33:48', who: '系统守护者',       a: '阻断',             target: '财务-138w 调拨',     r: 'high' },
                  { t: '14:32:08', who: '林·决策官',       a: 'A2A 下发',         target: '销售/运营/财务',     r: 'low' },
                  { t: '14:30:22', who: '昆仑（您）',       a: '审批通过',         target: 'Q3 客户回访预算',    r: 'low' },
                  { t: '14:28:51', who: '系统自动进化',     a: 'SOP 改进',         target: '资金调拨 v3 → v4',   r: 'low' },
                ].map((e, i) => (
                  <div key={i} className="hum-card-soft px-3 py-1.5 flex items-center gap-2 text-[12px]">
                    <span className="font-mono text-[10.5px] text-primary-700 w-16 shrink-0">{e.t}</span>
                    <span className="text-neutral-900 w-24 truncate">{e.who}</span>
                    <span className="text-neutral-600 flex-1 truncate">{e.a} → <span className="text-neutral-900">{e.target}</span></span>
                    <span className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, color: RISK_COLOR[e.r as keyof typeof RISK_COLOR], borderColor: `${RISK_COLOR[e.r as keyof typeof RISK_COLOR]}40`, background: 'transparent' }}>
                      {e.r.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="hum-card-soft p-3">
                <div className="hum-eyebrow mb-2">账本完整性</div>
                <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                  <KV label="总记录" value="14,847" />
                  <KV label="本周新增" value="2,310" />
                  <KV label="签名验证" value="✓ 100%" />
                  <KV label="篡改检测" value="0" />
                </div>
                <div className="mt-3 text-[11px] text-neutral-600 leading-relaxed">
                  SQLite WAL + 外键 + 触发器，所有 Agent 操作 / 审批 / 工具调用 / 文件 diff 入链不可篡改。
                </div>
              </div>
            </div>
          </Card>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Card({ span, icon, title, children }: { span: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="hum-card overflow-hidden flex flex-col" style={{ gridColumn: `span ${span} / span ${span}` }}>
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-primary-600">{icon}</span>
        <span className="text-[12px] font-semibold text-neutral-900">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="hum-card-soft px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wider hum-faint">{label}</div>
      <div className="text-[12px] font-semibold mt-0.5 text-neutral-900 hum-tabular">{value}</div>
    </div>
  );
}
