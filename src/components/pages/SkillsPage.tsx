/**
 * 技能库 — Skill Marketplace 完整视图
 */
import { useState, useMemo } from 'react';
import { Search, Filter, Play, Pause, Eye, Plus, BadgeCheck, AlertCircle } from 'lucide-react';
import WorkspacePage from './WorkspacePage';
import { skillItems, skillCategories, type SkillItem, type SkillCategory } from '../../data/skills';
import { useAppStore } from '../../store/useAppStore';

export default function SkillsPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SkillCategory | '全部'>('全部');
  const [detail, setDetail] = useState<SkillItem | null>(null);
  const installedSkills = useAppStore((s) => s.installedSkills);
  const toggleSkill = useAppStore((s) => s.toggleSkill);
  const installSkill = useAppStore((s) => s.installSkill);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);
  const triggerSlotIn = useAppStore((s) => s.triggerSlotIn);

  const filtered = useMemo(
    () =>
      skillItems.filter(
        (s) =>
          (cat === '全部' || s.category === cat) &&
          (q === '' || s.name.includes(q) || s.desc.includes(q)),
      ),
    [q, cat],
  );

  return (
    <WorkspacePage
      title="技能库"
      sub={`${skillItems.length} 个可调用 Skill / SOP · 全部经专家共创 + Hermes 沙箱评测`}
      actions={
        <>
          <button className="hum-btn is-sm"><Filter size={12} /> 筛选</button>
          <button className="hum-btn is-sm is-primary"><Plus size={12} /> 上传技能</button>
        </>
      }
      sticky={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索技能名 / 用途 / 适用员工…"
              className="hum-input pl-7"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <CatChip current={cat} value="全部" onClick={setCat} label="全部" />
            {skillCategories.map((c) => (
              <CatChip key={c} current={cat} value={c} onClick={setCat} label={c} />
            ))}
          </div>
          <span className="hum-chip is-muted ml-auto">{filtered.length} 个</span>
        </div>
      }
    >
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((s) => {
          const installed = !!installedSkills[s.id];
          const enabled = installedSkills[s.id]?.enabled ?? false;
          return (
            <div key={s.id} className="hum-card p-3 flex flex-col hover:hum-elev-2 transition">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-[13.5px] font-semibold text-neutral-900 truncate">{s.name}</div>
                    {s.signed ? (
                      <span title={s.signer} className="text-success"><BadgeCheck size={13} /></span>
                    ) : (
                      <span title="沙箱中 · 未签名" className="text-warning"><AlertCircle size={13} /></span>
                    )}
                  </div>
                  <div className="text-[10.5px] hum-faint mt-0.5 font-mono">{s.category} · {s.version}</div>
                </div>
              </div>

              <div className="text-[12px] hum-muted mt-2 line-clamp-2">{s.desc}</div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <Metric label="调用" value={s.callCount.toLocaleString()} />
                <Metric label="成功率" value={`${(s.successRate * 100).toFixed(1)}%`} accent />
                <Metric label="最近" value={s.lastUsed ?? '—'} mono />
              </div>

              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {s.applicable.slice(0, 2).map((r) => (
                  <span key={r} className="hum-chip is-muted">{r}</span>
                ))}
                {s.applicable.length > 2 && <span className="text-[10px] hum-faint">+{s.applicable.length - 2}</span>}
              </div>

              <div className="mt-3 pt-3 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={() => setDetail(s)} className="hum-btn is-sm">
                  <Eye size={11} /> 详情
                </button>
                {!installed ? (
                  <button
                    onClick={() => {
                      installSkill(s.id);
                      pushAudit({ actor: '昆仑（您）', action: '安装技能', target: s.name, result: 'ok', tags: ['skill:install'] });
                      pushToast({ kind: 'success', title: `${s.name} 已安装`, detail: '可在「我的员工」中分配给特定 Agent' });
                      triggerSlotIn({ agentName: s.applicable[0] ?? 'Agent', skillName: s.name, skillSource: s.signer ?? '专家共创' });
                    }}
                    className="hum-btn is-sm is-primary ml-auto"
                  >
                    安装
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      toggleSkill(s.id);
                      pushAudit({ actor: '昆仑（您）', action: enabled ? '禁用技能' : '启用技能', target: s.name, result: 'ok', tags: ['skill:toggle'] });
                      pushToast({ kind: 'info', title: `${s.name} ${enabled ? '已禁用' : '已启用'}` });
                    }}
                    className={`hum-btn is-sm ml-auto ${enabled ? '' : 'is-primary'}`}
                  >
                    {enabled ? <><Pause size={11} /> 禁用</> : <><Play size={11} /> 启用</>}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {detail && <SkillDetail skill={detail} onClose={() => setDetail(null)} />}
    </WorkspacePage>
  );
}

function CatChip({
  current, value, onClick, label,
}: { current: any; value: any; onClick: (v: any) => void; label: string }) {
  const isActive = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition ${
        isActive ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
      }`}
    >
      {label}
    </button>
  );
}

function Metric({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className="hum-card-soft px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider hum-faint">{label}</div>
      <div className={`text-[12.5px] mt-0.5 hum-tabular ${accent ? 'text-primary-600 font-semibold' : 'text-neutral-900'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

/* ─────────────────── Skill detail drawer ─────────────────── */

function SkillDetail({ skill, onClose }: { skill: SkillItem; onClose: () => void }) {
  return (
    <div className="absolute top-0 right-0 bottom-0 w-[460px] z-40 bg-white flex flex-col"
      style={{ borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-modal)' }}>
      <div className="px-5 py-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="hum-chip is-brand">{skill.category}</span>
            {skill.signed ? <span className="hum-chip is-success"><BadgeCheck size={11} /> 已签名</span>
              : <span className="hum-chip is-warning">沙箱中</span>}
          </div>
          <h2 className="text-[16px] font-semibold text-neutral-900">{skill.name}</h2>
          <div className="text-[11px] hum-muted mt-0.5 font-mono">{skill.version} · 签名：{skill.signer ?? '未签名'}</div>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 text-xl">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <div className="hum-eyebrow mb-1.5">说明</div>
          <p className="text-[12.5px] text-neutral-700 leading-relaxed">{skill.desc}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="累计调用" value={skill.callCount.toLocaleString()} />
          <Metric label="成功率" value={`${(skill.successRate * 100).toFixed(1)}%`} accent />
          <Metric label="最近调用" value={skill.lastUsed ?? '—'} mono />
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">权限范围</div>
          <div className="flex flex-wrap gap-1.5">
            {skill.permissionScope.map((p) => (
              <code key={p} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700">{p}</code>
            ))}
          </div>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">输入 Schema</div>
          <div className="hum-card-soft p-2 text-[11.5px] font-mono space-y-0.5">
            {skill.inputSchema.map((f) => (
              <div key={f.name} className="flex gap-2">
                <span className="text-primary-700">{f.name}</span>
                <span className="text-neutral-500">{f.type}</span>
                {f.required && <span className="text-error">*</span>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">输出 Schema</div>
          <div className="hum-card-soft p-2 text-[11.5px] font-mono space-y-0.5">
            {skill.outputSchema.map((f) => (
              <div key={f.name} className="flex gap-2">
                <span className="text-secondary-700">{f.name}</span>
                <span className="text-neutral-500">{f.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hum-eyebrow mb-1.5">最近调用日志</div>
          <div className="space-y-1">
            {skill.recentCalls.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-[11.5px]">
                <span className="hum-faint font-mono w-16">{c.ts.slice(0, 8)}</span>
                <span className="flex-1 text-neutral-700">{c.caller} · {c.note}</span>
                <span className={c.result === 'ok' ? 'hum-chip is-success' : c.result === 'warn' ? 'hum-chip is-warning' : 'hum-chip is-error'} style={{ padding: '1px 6px', fontSize: 10 }}>
                  {c.result.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
