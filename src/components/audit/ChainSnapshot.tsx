/**
 * 责任链快照 — 从单条审计记录重构五级责任链（纯前端 mock 推导）
 * 输入只有 AuditEntry + 静态数据文件（executives / employees / skills），
 * 授权依据（grant 编号 / A2A 委派记录 / 策略规则 id）均为确定性 mock。
 */
import { Crown, UserRound, Bot, ShieldCheck, Cpu, Link2, ScrollText, BadgeCheck, SearchCheck } from 'lucide-react';
import type { AuditEntry } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { executiveTwins, HUMAN_BOSS, BOSS_TWIN, type ExecutiveTwin } from '../../data/executives';
import { skillItems } from '../../data/skills';
import type { Employee } from '../../lib/types';

// ─────────────────────── mock 推导逻辑 ───────────────────────

/** 确定性伪随机：同一条记录每次展开推导结果一致 */
function seed(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 99991;
  return h;
}

function findEmployee(actor: string): Employee | undefined {
  return employees.find((e) => actor === e.name || actor.includes(e.name) || e.name.includes(actor));
}

/** 按 actor 部门/职务从 executives.ts 匹配所属高管分身 */
function findExecFor(emp: Employee): ExecutiveTwin {
  const direct = executiveTwins.find((x) => x.managesEmployeeIds.includes(emp.id));
  if (direct) return direct;
  const key = emp.role + emp.department;
  const byKeyword =
    (key.includes('销售') && executiveTwins.find((x) => x.id === 'exec-sales')) ||
    ((key.includes('运营') || key.includes('设计') || key.includes('客服') || key.includes('营销')) &&
      executiveTwins.find((x) => x.id === 'exec-ops')) ||
    ((key.includes('产品') || key.includes('研发') || key.includes('数据')) &&
      executiveTwins.find((x) => x.id === 'exec-product')) ||
    ((key.includes('财务') || key.includes('法务')) && executiveTwins.find((x) => x.id === 'exec-finance'));
  return byKeyword || executiveTwins[0];
}

export interface ChainLevel {
  tier: string;       // L1…L5
  roleLabel: string;  // 真人老板 / 老板数字分身 / 高管分身 / 真人高管 / 数字员工
  name: string;
  sub: string;
  basis: string;      // 授权依据
  kind: 'human' | 'twin' | 'exec' | 'agent' | 'system';
}

/** 五级责任链重构；系统组件（Exec-Guardian / Hermes / 老板本人）走短链 */
function deriveChain(entry: AuditEntry): ChainLevel[] {
  const n = seed(entry.id + entry.hash);
  const grantNo = `GRANT-2026-${String(100 + (n % 880)).padStart(3, '0')}`;
  const bossNode: ChainLevel = {
    tier: 'L1', roleLabel: '真人老板', kind: 'human',
    name: HUMAN_BOSS.name, sub: HUMAN_BOSS.title,
    basis: `企业根权限 · 授权仪式 ${grantNo} 创始签署`,
  };
  const twinNode: ChainLevel = {
    tier: 'L2', roleLabel: '老板数字分身', kind: 'twin',
    name: BOSS_TWIN.name, sub: '企业意图入口 · 持目标与授权',
    basis: `授权仪式 ${grantNo} · 签署有效（有效期至 2026-12-31）`,
  };

  if (entry.actor.includes('昆仑')) {
    return [{ ...bossNode, basis: '本人操作 · 企业根权限（无需上游授权）' }];
  }

  const emp = findEmployee(entry.actor);
  if (!emp) {
    return [
      bossNode,
      twinNode,
      {
        tier: 'L3', roleLabel: '平台治理组件', kind: 'system',
        name: entry.actor, sub: '内置守护 / 进化引擎 · 平台签名',
        basis: `策略引擎根授权 POL-ROOT-001 · 部署签名 sha256:${entry.hash.slice(2)}…`,
      },
    ];
  }

  const exec = findExecFor(emp);
  return [
    bossNode,
    twinNode,
    {
      tier: 'L3', roleLabel: '高管分身', kind: 'exec',
      name: exec.name, sub: exec.role,
      basis: `A2A 委派记录 A2A-${1000 + ((n * 7) % 8999)} · 目标下发已确认`,
    },
    {
      tier: 'L4', roleLabel: '真人高管', kind: 'human',
      name: exec.humanName, sub: exec.humanTitle,
      basis: `策略规则 POL-${String(1 + (n % 9)).padStart(3, '0')} · 人签确认边界内代理`,
    },
    {
      tier: 'L5', roleLabel: '数字员工', kind: 'agent',
      name: emp.name, sub: `${emp.role} · ${emp.department}`,
      basis: `权限 grant ${grantNo}-S${1 + (n % 4)} · 技能签名校验通过`,
    },
  ];
}

/** 依据 SOP 版本：优先 skill 标签 → 最近调用记录 → 适用角色 → 已装备技能 */
function deriveSop(entry: AuditEntry, emp: Employee | undefined): string {
  const skillTag = (entry.tags ?? []).find((t) => t.startsWith('skill:'));
  if (skillTag) {
    const raw = skillTag.slice(6);
    const hit = skillItems.find((sk) => raw.includes(sk.version) || sk.name.includes(raw));
    return hit ? `${hit.name}（${hit.version} · 已签名）` : `${raw}（市场签名 Skill）`;
  }
  const byCall = skillItems.find((sk) => sk.recentCalls.some((c) => c.caller === entry.actor));
  if (byCall) return `${byCall.name}（${byCall.version} · 已签名）`;
  if (emp) {
    const byRole = skillItems.find((sk) => sk.applicable.includes(emp.role));
    if (byRole) return `${byRole.name}（${byRole.version} · 已签名）`;
    const equipped = emp.skills.find((s) => s.equipped);
    if (equipped) return `${equipped.name} SOP（v${equipped.level}.0 · 内置基线）`;
  }
  return '平台基线 SOP（v1.0 · 内置）';
}

/** 命中策略规则：blocked / warning / risk / human-in-loop 标签驱动 */
function derivePolicy(entry: AuditEntry): { hit: boolean; label: string } {
  const tags = entry.tags ?? [];
  const hasRiskTag = tags.some((t) => t.startsWith('risk'));
  if (entry.result === 'blocked' || tags.includes('risk:high')) {
    return { hit: true, label: '单笔 > 50w 四眼原则 · POL-004（强制阻断回传）' };
  }
  if (tags.includes('human-in-loop')) {
    return { hit: true, label: '人工在环强制审批 · POL-002（外发/预算类动作）' };
  }
  if (entry.result === 'warning' || hasRiskTag) {
    return { hit: true, label: '敏感动作外发扫描 · POL-007（DLP 告警留痕）' };
  }
  return { hit: false, label: '常规动作 · 未命中风控规则' };
}

/** 专家认证状态：员工 expert 字段 → 林知远认证签名 */
function deriveExpert(emp: Employee | undefined): { certified: boolean; label: string; sub: string } {
  if (emp?.expert) {
    return { certified: true, label: '林知远 认证 · 签名有效', sub: `背书专家：${emp.expert}` };
  }
  return { certified: false, label: '平台内置组件 · 免专家认证', sub: '由平台安全基线覆盖' };
}

// ─────────────────────── 视图 ───────────────────────

const KIND_ICON = { human: Crown, twin: Bot, exec: Cpu, agent: UserRound, system: ShieldCheck } as const;
const KIND_TONE: Record<ChainLevel['kind'], string> = {
  human: 'bg-amber-50 text-amber-700 border-amber-200',
  twin: 'bg-sky-50 text-sky-700 border-sky-200',
  exec: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  agent: 'bg-teal-50 text-teal-700 border-teal-200',
  system: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

interface ChainSnapshotProps {
  entry: AuditEntry;
  prevHash: string;
}

export default function ChainSnapshot({ entry, prevHash }: ChainSnapshotProps) {
  const chain = deriveChain(entry);
  const emp = findEmployee(entry.actor);
  const sop = deriveSop(entry, emp);
  const policy = derivePolicy(entry);
  const expert = deriveExpert(emp);

  return (
    <div className="px-4 pb-4 pt-3" style={{ borderTop: '1px dashed var(--border-subtle)' }}>
      {/* 头部：快照标识 + 链式哈希关系 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="hum-eyebrow flex items-center gap-1">
          <SearchCheck size={11} /> 责任链快照
        </span>
        <span className="text-[11px] hum-faint">由本条记录重构 · 可追责到人</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] font-mono text-neutral-500">
          <Link2 size={11} className="text-neutral-400" />
          <span>prev {prevHash}</span>
          <span className="text-neutral-300">→</span>
          <span className="text-neutral-800 font-medium">entry {entry.hash}</span>
          <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>链式校验通过</span>
        </span>
      </div>

      {/* 五级责任链 */}
      <div className="mt-3">
        {chain.map((lv, i) => {
          const Icon = KIND_ICON[lv.kind];
          const isActor = i === chain.length - 1;
          return (
            <div key={lv.tier} className="flex gap-3">
              {/* 左侧节点轨道 */}
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${KIND_TONE[lv.kind]}`}>
                  <Icon size={13} />
                </div>
                {i < chain.length - 1 && <div className="w-px flex-1 min-h-[14px] bg-neutral-200" />}
              </div>
              {/* 节点内容 */}
              <div className={`flex-1 min-w-0 ${i < chain.length - 1 ? 'pb-3' : ''}`}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-neutral-400">{lv.tier}</span>
                  <span className="hum-eyebrow" style={{ letterSpacing: '0.04em' }}>{lv.roleLabel}</span>
                  <span className={`text-[12.5px] font-medium ${isActor ? 'text-neutral-900' : 'text-neutral-800'}`}>
                    {lv.name}
                  </span>
                  <span className="text-[11px] hum-faint">{lv.sub}</span>
                  {isActor && (
                    <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>本条记录执行者</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-neutral-500 flex items-center gap-1">
                  <ShieldCheck size={10} className="text-success shrink-0" />
                  <span className="truncate">授权依据：{lv.basis}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 三行关键信息 */}
      <div className="mt-3 hum-card-soft rounded-lg divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        <KeyRow icon={ScrollText} label="依据 SOP 版本" value={sop} tone="neutral" />
        <KeyRow
          icon={ShieldCheck}
          label="命中策略规则"
          value={policy.label}
          tone={policy.hit ? 'warning' : 'muted'}
        />
        <KeyRow icon={BadgeCheck} label="专家认证状态" value={expert.label} sub={expert.sub}
          tone={expert.certified ? 'success' : 'muted'} />
      </div>
    </div>
  );
}

function KeyRow({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof ScrollText;
  label: string;
  value: string;
  sub?: string;
  tone: 'success' | 'warning' | 'neutral' | 'muted';
}) {
  const valueCls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'muted' ? 'text-neutral-500' :
    'text-neutral-800';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
      <Icon size={12} className="text-neutral-400 shrink-0" />
      <span className="text-[11px] hum-muted w-24 shrink-0">{label}</span>
      <span className={`text-[12px] font-medium ${valueCls}`}>{value}</span>
      {sub && <span className="text-[10.5px] hum-faint ml-auto">{sub}</span>}
    </div>
  );
}
