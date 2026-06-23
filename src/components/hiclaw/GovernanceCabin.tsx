import { motion } from 'framer-motion';
import {
  X, Shield, Users, Key, Cpu, Activity, AlertTriangle, Cable, Building2, Globe2, CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';

const departments = [
  { name: '决策中心', headcount: 1, model: 'Opus 4.7', cost: '$12.4' },
  { name: '业务办公区', headcount: 5, model: 'Mixed', cost: '$21.0' },
  { name: '行政支持中心', headcount: 3, model: 'Haiku 4.5', cost: '$7.8' },
  { name: '会议室', headcount: 1, model: 'Opus 4.7', cost: '$4.3' },
  { name: '休息区', headcount: 1, model: 'Sonnet 4.6', cost: '$1.9' },
  { name: '学习进化区', headcount: 1, model: 'Sandbox', cost: '$3.0' },
];

const aiGateway = [
  { name: 'Claude Opus 4.7', tpm: '1.4M / 2M', latency: '820ms', status: 'green' },
  { name: 'Claude Sonnet 4.6', tpm: '3.1M / 5M', latency: '320ms', status: 'green' },
  { name: 'Claude Haiku 4.5', tpm: '4.2M / 8M', latency: '140ms', status: 'green' },
  { name: '本地 OpenClaw RT', tpm: '380K / 1M', latency: '90ms', status: 'green' },
  { name: 'DeepSeek-V3 (备用)', tpm: '120K / 1M', latency: '410ms', status: 'amber' },
];

const skillHub = [
  { name: 'BD 邮件 v3.2', author: '陈鹏 共创', signed: true, version: 'v3.2', hires: 1284, risk: 'low' },
  { name: '618 复盘 v4.1', author: '吴琳 共创', signed: true, version: 'v4.1', hires: 1782, risk: 'low' },
  { name: '合同审阅 v2.7', author: '黄律 共创', signed: true, version: 'v2.7', hires: 712, risk: 'medium' },
  { name: '资金调拨 v3 → v4', author: 'Hermes 自动进化', signed: false, version: 'v4 (sandbox)', hires: 0, risk: 'medium' },
];

const mcpHub = [
  { name: 'crm.salesforce', kind: 'CRM', status: 'green' },
  { name: 'erp.kingdee', kind: 'ERP', status: 'green' },
  { name: 'feishu.docs', kind: '飞书文档', status: 'green' },
  { name: 'feishu.approval', kind: '飞书审批', status: 'green' },
  { name: 'wework.message', kind: '企业微信', status: 'green' },
  { name: 'gitlab.repo', kind: 'GitLab', status: 'green' },
  { name: 'bi.warehouse', kind: '数仓', status: 'green' },
  { name: 'kg.enterprise', kind: '企业 KG', status: 'green' },
  { name: 'mail.exchange', kind: '邮件外发', status: 'amber' },
];

const riskHeat = [
  ['low', 'low', 'low', 'medium', 'low', 'low'],
  ['low', 'low', 'low', 'low', 'low', 'low'],
  ['low', 'medium', 'high', 'low', 'low', 'low'],
  ['low', 'low', 'low', 'low', 'low', 'medium'],
  ['low', 'low', 'low', 'low', 'low', 'low'],
];

export default function GovernanceCabin() {
  const { setShowGovernance } = useAppStore();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-ink-900/85 backdrop-blur-md flex"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="m-6 flex-1 glass-strong rounded-sm relative hud-corner flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-neon-cyan/20 flex items-center gap-3 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/10 to-transparent pointer-events-none" />
          <Shield size={22} className="text-neon-cyan relative" />
          <div className="relative">
            <div className="font-display text-xl tracking-widest neon-text">HiClaw 治理舱</div>
            <div className="text-[11px] font-mono text-neon-cyan/60">ENTERPRISE GOVERNANCE COCKPIT · 多租户 · AI Gateway · Skill / MCP Hub · 风险热力图 · 审计</div>
          </div>
          <div className="flex-1" />
          <span className="chip-green"><CheckCircle2 size={10} /> ALL GREEN</span>
          <button onClick={() => setShowGovernance(false)} className="text-slate-400 hover:text-neon-cyan">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-4">
          <Card span={4} icon={<Building2 size={14} />} title="租户 · 部门 · 角色">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <KV label="租户" value="蓝血军团" />
                <KV label="部门" value={`${departments.length}`} />
                <KV label="员工" value={`${employees.length}`} />
              </div>
              <div className="mt-2 space-y-1">
                {departments.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 px-2 py-1.5 glass rounded-sm">
                    <Users size={11} className="text-neon-cyan" />
                    <span className="flex-1 text-xs text-slate-200">{d.name}</span>
                    <span className="text-[10px] font-mono text-slate-400">{d.headcount}</span>
                    <span className="text-[10px] font-mono text-neon-amber">{d.cost}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card span={4} icon={<Cpu size={14} />} title="AI Gateway · 模型路由">
            <div className="space-y-1.5">
              {aiGateway.map((g) => (
                <div key={g.name} className="glass rounded-sm p-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${g.status === 'green' ? 'bg-neon-green' : 'bg-neon-amber'}`} />
                    <span className="text-xs text-slate-200 flex-1">{g.name}</span>
                    <span className="text-[10px] font-mono text-neon-cyan">{g.latency}</span>
                  </div>
                  <div className="mt-1.5">
                    <div className="h-1 rounded-sm bg-white/5 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-neon-cyan to-neon-magenta" style={{ width: `${(parseFloat(g.tpm) / parseFloat(g.tpm.split('/')[1])) * 100}%` }} />
                    </div>
                    <div className="text-[9px] font-mono text-slate-500 mt-0.5">{g.tpm} TPM</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] font-mono text-neon-cyan/70 flex items-center gap-1">
              <Key size={10} /> 凭证统一托管 · Agent 不持密钥
            </div>
          </Card>

          <Card span={4} icon={<AlertTriangle size={14} />} title="风险热力图（实时）">
            <div className="grid grid-cols-6 gap-1">
              {riskHeat.flat().map((r, i) => {
                const color = r === 'high' ? '#ff3860' : r === 'medium' ? '#ffb800' : '#00ff88';
                return <div key={i} className="aspect-square rounded-sm" style={{ background: `${color}44`, boxShadow: `inset 0 0 0 1px ${color}` }} />;
              })}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="text-[10px]"><span className="inline-block w-2 h-2 rounded-sm bg-neon-green mr-1" />低</div>
              <div className="text-[10px]"><span className="inline-block w-2 h-2 rounded-sm bg-neon-amber mr-1" />中</div>
              <div className="text-[10px]"><span className="inline-block w-2 h-2 rounded-sm bg-neon-red mr-1" />高</div>
            </div>
            <div className="mt-3 glass rounded-sm p-2 border border-neon-red/30">
              <div className="flex items-center gap-2 text-neon-red text-xs">
                <AlertTriangle size={12} /> 1 起 HIGH · 财务-138w 调拨
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-1">已阻断 · 等待昆仑审批</div>
            </div>
          </Card>

          <Card span={6} icon={<Cable size={14} />} title="Skill / MCP Hub · 签名与版本">
            <div className="space-y-1.5">
              {skillHub.map((s) => (
                <div key={s.name} className="glass rounded-sm p-2 flex items-center gap-2">
                  {s.signed ? <CheckCircle2 size={12} className="text-neon-green" /> : <AlertTriangle size={12} className="text-neon-amber animate-pulse" />}
                  <div className="flex-1">
                    <div className="text-xs text-slate-200">{s.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{s.author} · {s.version}</div>
                  </div>
                  <span className={`chip ${
                    s.risk === 'high' ? 'text-neon-red border-neon-red/40' :
                    s.risk === 'medium' ? 'text-neon-amber border-neon-amber/40' :
                    'text-neon-green border-neon-green/40'} bg-transparent`}>
                    {s.risk.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card span={6} icon={<Globe2 size={14} />} title="MCP Servers · 企业接入">
            <div className="grid grid-cols-3 gap-2">
              {mcpHub.map((m) => (
                <div key={m.name} className="glass rounded-sm p-2 flex items-start gap-2">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full ${m.status === 'green' ? 'bg-neon-green' : 'bg-neon-amber'}`} />
                  <div>
                    <div className="text-[11px] font-mono text-slate-200">{m.name}</div>
                    <div className="text-[10px] text-slate-400">{m.kind}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] font-mono text-neon-cyan/70">
              对内：MCP 连接工具/数据/业务系统 · 对外：A2A 协议跨 Agent / 跨组织协作
            </div>
          </Card>

          <Card span={12} icon={<Activity size={14} />} title="审计流（实时） · Append-only Ledger">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                {[
                  { t: '14:35:12', who: '雪·销售官', a: '生成 BD 邮件草稿', target: '鲲鹏制造', r: 'low' },
                  { t: '14:33:48', who: 'Exec-Guardian', a: '阻断', target: '财务-138w 调拨', r: 'high' },
                  { t: '14:32:08', who: '林·决策官', a: 'A2A 下发', target: '销售/运营/财务', r: 'low' },
                  { t: '14:30:22', who: '昆仑（人）', a: '审批通过', target: 'Q3 客户回访预算', r: 'low' },
                  { t: '14:28:51', who: 'Hermes', a: 'SOP 进化', target: '资金调拨 v3 → v4', r: 'low' },
                ].map((e, i) => (
                  <div key={i} className="glass rounded-sm px-3 py-1.5 flex items-center gap-2 text-xs">
                    <span className="font-mono text-[10px] text-neon-cyan w-16 shrink-0">{e.t}</span>
                    <span className="text-slate-200 w-32 truncate">{e.who}</span>
                    <span className="text-slate-300 flex-1 truncate">{e.a} → <span className="text-slate-100">{e.target}</span></span>
                    <span className={`chip ${e.r === 'high' ? 'text-neon-red border-neon-red/40' : 'text-neon-green border-neon-green/40'} bg-transparent`}>
                      {e.r.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="glass rounded-sm p-3 border border-neon-cyan/20">
                <div className="text-[11px] font-display text-neon-cyan tracking-wider mb-2">Ledger 完整性</div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <KV label="总记录" value="14,847" />
                  <KV label="本周新增" value="2,310" />
                  <KV label="签名校验" value="✓ 100%" />
                  <KV label="篡改检测" value="0" />
                </div>
                <div className="mt-3 font-mono text-[10px] text-slate-400 leading-relaxed">
                  采用 SQLite WAL + 外键 + 触发器，记录不可篡改。所有 Agent 操作 / 人审批准 / 工具调用 / 文件 diff 均入链。
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
    <div className={`col-span-12 md:col-span-${span} glass rounded-sm relative hud-corner`} style={{ gridColumn: `span ${span} / span ${span}` }}>
      <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
        <span className="text-neon-cyan">{icon}</span>
        <div className="text-[11px] font-display tracking-widest text-neon-cyan">{title}</div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-sm px-2 py-1.5 border border-white/5">
      <div className="text-[9px] font-mono text-neon-cyan/70 uppercase tracking-wider">{label}</div>
      <div className="text-[12px] font-display text-slate-100 mt-0.5">{value}</div>
    </div>
  );
}
