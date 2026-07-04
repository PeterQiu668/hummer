/**
 * 员工市场（v7 龙虾化 + Notion 浅色）
 * - 11 大经营环节分类
 * - 固定专家阵容（不占位）
 * - 3 + 1 档套餐
 * - 体验工坊试用抽屉
 * - 安装后写入 localStorage，可被「我的员工」/ 首页工位读出
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Search, Sparkles, BadgeCheck, Star, ShoppingCart, Zap, ChevronRight,
  Building2, Briefcase, ArrowRight, Users, Award, CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { marketEmployees } from '../../data/marketplace';
import {
  experts, expertsById, businessStages, teamPackages,
} from '../../data/experts';
import { buildCandidates } from '../../data/trial';
import AgentAvatar from '../ui/AgentAvatar';
import LifecycleBoard from '../onboarding/LifecycleBoard';

type Tab = 'browse' | 'packages' | 'wizard' | 'experts' | 'mine';

// Map marketplace category → business stage for grouping
const CATEGORY_TO_STAGE: Record<string, string> = {
  '战略决策': 'st-strategy',
  '销售增长': 'st-sales',
  '运营增长': 'st-ops',
  '内容创作': 'st-marketing',
  '客户服务': 'st-cs',
  '研发工程': 'st-product',
  '数据分析': 'st-data',
  '财务税务': 'st-finance',
  '法务合规': 'st-legal',
  '人力资源': 'st-hr',
  '行政后勤': 'st-hr',
};

// v8: marketEmployees 旧专家名 → 6 位固定专家 id（按经营环节就近映射）
const EXPERT_BY_CATEGORY: Record<string, string> = {
  '战略决策': 'ex-lin',
  '销售增长': 'ex-chen',
  '运营增长': 'ex-han',
  '内容创作': 'ex-xu',
  '客户服务': 'ex-liang',
  '财务税务': 'ex-zhou',
  '法务合规': 'ex-zhou',
  '研发工程': 'ex-lin',
  '数据分析': 'ex-han',
  '人力资源': 'ex-lin',
  '行政后勤': 'ex-han',
};

export default function Marketplace() {
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const triggerSlotIn = useAppStore((s) => s.triggerSlotIn);
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);

  const [tab, setTab] = useState<Tab>('browse');
  const [q, setQ] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [trialEmp, setTrialEmp] = useState<typeof marketEmployees[number] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>(
    () => JSON.parse(localStorage.getItem('hummer-marketplace-hires') ?? '{}'),
  );

  // 「我的招聘」= 生命周期候选（seed）+ 从「浏览员工」新招聘的员工
  const mineCount = useMemo(() => buildCandidates(installed).length, [installed]);

  const filtered = useMemo(() => {
    return marketEmployees.filter((m) => {
      const stage = CATEGORY_TO_STAGE[m.category];
      const stageMatch = stageFilter === 'all' || stage === stageFilter;
      const qMatch = q === '' || m.name.includes(q) || m.tagline.includes(q) || m.expert.includes(q) || m.tags.some((t) => t.includes(q));
      return stageMatch && qMatch;
    });
  }, [q, stageFilter]);

  const onHire = (m: typeof marketEmployees[number]) => {
    const next = { ...installed, [m.id]: true };
    setInstalled(next);
    localStorage.setItem('hummer-marketplace-hires', JSON.stringify(next));
    pushAudit({ actor: '昆仑（您）', action: '招聘数字员工', target: m.name, result: 'ok', tags: ['marketplace', 'hire'] });
    pushToast({ kind: 'success', title: `${m.name} 已进入沙箱试岗`, detail: '试岗第 1 天 · 在「我的招聘」查看试岗报告与转正决策' });
    triggerSlotIn({ agentName: m.name, skillName: m.tags[0] ?? '岗位 SOP', skillSource: m.expert });
  };

  const onInstallPackage = (pkgId: string) => {
    const pkg = teamPackages.find((p) => p.id === pkgId)!;
    pushAudit({ actor: '昆仑（您）', action: '一键部署团队套餐', target: pkg.name, result: 'pending', tags: ['marketplace', 'package'] });
    pushToast({ kind: 'info', title: `${pkg.name} 部署中`, detail: `${pkg.agentCount} 位数字员工 · 预计 3 分钟完成` });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="m-6 flex-1 bg-white rounded-xl overflow-hidden flex flex-col"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="w-10 h-10 rounded-lg bg-primary-50 grid place-items-center">
            <Briefcase size={18} className="text-primary-700" />
          </div>
          <div className="flex-1">
            <h1 className="hum-h1 text-[20px]">员工市场</h1>
            <p className="text-[12.5px] hum-muted mt-0.5">
              {marketEmployees.length} 位专家共创数字员工 · 覆盖 {businessStages.length} 大经营环节 · 7 天试岗
            </p>
          </div>
          <button onClick={() => setShowMarketplace(false)} className="text-neutral-400 hover:text-neutral-900">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex items-center gap-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {([
            { key: 'browse', label: '浏览员工', count: marketEmployees.length },
            { key: 'packages', label: '团队套餐', count: teamPackages.length },
            { key: 'wizard', label: '定制 5 步', count: 5 },
            { key: 'experts', label: '专家保障', count: experts.length },
            { key: 'mine', label: '我的招聘', count: mineCount },
          ] as { key: Tab; label: string; count: number }[]).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-[13px] font-medium flex items-center gap-1.5 transition border-b-2 -mb-px ${
                  active ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {t.label}
                <span className={`text-[10.5px] font-mono ${active ? 'text-neutral-500' : 'text-neutral-400'}`}>({t.count})</span>
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        {tab === 'browse' && (
          <BrowseTab
            filtered={filtered}
            q={q} setQ={setQ}
            stageFilter={stageFilter} setStageFilter={setStageFilter}
            installed={installed}
            onHire={onHire}
            onTrial={setTrialEmp}
          />
        )}
        {tab === 'packages' && (
          <PackagesTab onInstall={onInstallPackage} />
        )}
        {tab === 'wizard' && <WizardTab onInstall={onInstallPackage} />}
        {tab === 'experts' && <ExpertsTab />}
        {tab === 'mine' && (
          <LifecycleBoard installed={installed} />
        )}

        {/* Footer */}
        <div className="px-6 py-2.5 flex items-center gap-4 bg-neutral-25 text-[11.5px] text-neutral-600" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Zap size={12} className="text-warning" />
          <span>每位 Agent 都有真人专家兜底 · 7 天试岗不满意可下架 · 数据完全私有</span>
          <span className="flex-1" />
          <button className="hum-btn is-sm">联系顾问定制 54 岗位</button>
        </div>
      </motion.div>

      {/* Trial drawer */}
      {trialEmp && <TrialDrawer emp={trialEmp} onClose={() => setTrialEmp(null)} onHire={() => { onHire(trialEmp); setTrialEmp(null); }} />}
    </motion.div>
  );
}

/* ─────────── Browse tab ─────────── */
function BrowseTab({
  filtered, q, setQ, stageFilter, setStageFilter, installed, onHire, onTrial,
}: any) {
  return (
    <>
      <div className="px-6 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="relative max-w-md flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜员工 / 岗位 / 技能标签 / 共创专家"
            className="hum-input pl-7"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <StageChip current={stageFilter} value="all" onClick={setStageFilter} label="全部" />
          {businessStages.map((s) => (
            <StageChip key={s.id} current={stageFilter} value={s.id} onClick={setStageFilter} label={s.name} color={s.color} />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((m: any) => {
          const expertId = EXPERT_BY_CATEGORY[m.category];
          const expert = expertId ? expertsById.get(expertId) : undefined;
          const isInstalled = !!installed[m.id];
          return (
            <div key={m.id} className="hum-card overflow-hidden flex flex-col hover:hum-elev-2 transition">
              {/* Color band header */}
              <div
                className="h-14 relative"
                style={{ background: `linear-gradient(135deg, ${m.color}1A, ${m.color}08)` }}
              >
                <div
                  className="absolute -bottom-5 left-3 w-10 h-10 rounded-xl grid place-items-center text-[15px] font-display font-bold text-white"
                  style={{ background: m.color }}
                >
                  {m.avatar}
                </div>
                {m.certified && (
                  <span className="absolute top-2 right-2 hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>
                    <BadgeCheck size={10} /> 专家认证
                  </span>
                )}
              </div>
              <div className="p-3 pt-6 flex-1 flex flex-col">
                <div className="text-[13.5px] font-semibold text-neutral-900">{m.name}</div>
                <div className="text-[10.5px] hum-faint mt-0.5">{m.category}</div>
                <div className="text-[12px] text-neutral-700 mt-1.5 line-clamp-2">{m.tagline}</div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tags.slice(0, 3).map((t: string) => (
                    <span key={t} className="hum-chip" style={{ padding: '1px 6px', fontSize: 10 }}>{t}</span>
                  ))}
                </div>

                <div className="mt-3 pt-2.5 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {expert ? (
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <div
                        className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-semibold text-white shrink-0"
                        style={{ background: expert.color }}
                      >
                        {expert.avatar}
                      </div>
                      <div className="leading-tight min-w-0">
                        <div className="text-[11px] text-neutral-700 truncate">{expert.name}</div>
                        <div className="text-[9.5px] hum-faint truncate">{expert.title}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 text-[11px] hum-faint">{m.expert}</div>
                  )}
                  <span className="flex items-center gap-0.5 text-[10.5px] text-neutral-600 hum-tabular">
                    <Star size={9} className="text-warning" /> {m.rating}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button onClick={() => onTrial(m)} className="hum-btn is-sm justify-center" disabled={isInstalled}>
                    <Sparkles size={11} /> 体验工坊
                  </button>
                  {isInstalled ? (
                    <button className="hum-btn is-sm is-primary justify-center" disabled>
                      <CheckCircle2 size={11} /> 已招聘
                    </button>
                  ) : (
                    <button onClick={() => onHire(m)} className="hum-btn is-sm is-primary justify-center">
                      <ShoppingCart size={11} /> 招聘
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StageChip({ current, value, onClick, label, color }: any) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition ${
        active ? 'bg-neutral-900 text-white' : 'hum-card-soft text-neutral-600 hover:text-neutral-900'
      }`}
      style={active && color ? { background: color } : undefined}
    >
      {label}
    </button>
  );
}

/* ─────────── Packages tab ─────────── */
function PackagesTab({ onInstall }: { onInstall: (id: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <p className="text-[13px] text-neutral-700 mb-5 max-w-2xl">
        每个套餐由专家组合而成，覆盖经营环节 + 责任链路 + 月度成本。
        一键部署到「我的员工」，可在首页 Agent Workforce 工位中看到。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {teamPackages.map((pkg) => {
          const stages = pkg.stages.map((id) => businessStages.find((s) => s.id === id)!);
          return (
            <div
              key={pkg.id}
              className="hum-card p-5 flex flex-col"
              style={pkg.recommended ? { borderColor: 'var(--brand)', boxShadow: 'var(--shadow-2)' } : undefined}
            >
              {pkg.recommended && (
                <span className="hum-chip is-brand mb-2 self-start" style={{ padding: '2px 8px' }}>
                  推荐
                </span>
              )}
              <div className="text-[16px] font-semibold text-neutral-900">{pkg.name}</div>
              <div className="text-[12px] hum-muted mt-0.5">{pkg.subtitle}</div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[28px] font-bold text-neutral-900 hum-tabular">
                  {pkg.monthlyCost > 0 ? `¥${(pkg.monthlyCost / 1000).toFixed(1)}k` : '面议'}
                </span>
                {pkg.monthlyCost > 0 && <span className="text-[11px] hum-faint">/月</span>}
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-neutral-600">
                <Users size={12} /> {pkg.agentCount} 位数字员工
              </div>

              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="hum-eyebrow mb-1.5">覆盖经营环节</div>
                <div className="flex flex-wrap gap-1">
                  {stages.map((s) => (
                    <span
                      key={s.id}
                      className="hum-chip"
                      style={{ padding: '1px 6px', fontSize: 10, background: `${s.color}1A`, color: s.color, borderColor: `${s.color}33` }}
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 text-[11.5px] text-neutral-700">{pkg.bestFor}</div>

              <button
                onClick={() => onInstall(pkg.id)}
                className={`mt-4 hum-btn justify-center ${pkg.recommended ? 'is-primary' : ''}`}
              >
                {pkg.monthlyCost > 0 ? '一键部署' : '联系销售'} <ArrowRight size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── Experts tab ─────────── */
function ExpertsTab() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <p className="text-[13px] text-neutral-700 mb-5 max-w-2xl">
        每位数字员工背后都有一位真人专家做 SOP 共创 + 兜底。
        专家不是营销词 — 出问题时由专家直接介入。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {experts.map((ex) => (
          <div key={ex.id} className="hum-card p-4 flex gap-3">
            <div
              className="w-14 h-14 rounded-xl grid place-items-center text-white text-[18px] font-display font-bold shrink-0"
              style={{ background: ex.color }}
            >
              {ex.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-neutral-900">{ex.name}</span>
                <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>
                  <Award size={10} /> {ex.title}
                </span>
              </div>
              <p className="text-[12px] text-neutral-700 mt-1 leading-relaxed">{ex.expertise}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {ex.experienceTags.map((tag) => (
                  <span key={tag} className="hum-chip" style={{ padding: '1px 6px', fontSize: 10 }}>{tag}</span>
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-3 text-[11px] hum-faint">
                <span>共创 {ex.agentCount} 个 Agent</span>
                <span>·</span>
                <span>从业 {ex.yearsActive} 年</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────── Wizard tab (5 步定制) ─────────── */
function WizardTab({ onInstall }: { onInstall: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    size: '50-300 人', stage: '增长期', industry: 'SaaS / 企业服务',
  });
  const [goals, setGoals] = useState<string[]>(['提升销售转化率', '降低运营成本']);
  const [stages, setStages] = useState<string[]>(['st-sales', 'st-marketing', 'st-cs', 'st-product']);

  const stepsMeta = [
    { id: 0, label: '企业画像' },
    { id: 1, label: '业务目标' },
    { id: 2, label: '选择经营环节' },
    { id: 3, label: '推荐团队' },
    { id: 4, label: '预览部署' },
  ];

  const recommended = useMemo(() => {
    // Match best package by stages overlap
    const overlap = (pkg: any) => pkg.stages.filter((s: string) => stages.includes(s)).length;
    const sorted = [...teamPackages].sort((a, b) => overlap(b) - overlap(a));
    return sorted[0];
  }, [stages]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stepper */}
      <div className="px-6 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {stepsMeta.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold ${
              i < step ? 'bg-primary-600 text-white' :
              i === step ? 'bg-neutral-900 text-white' :
              'bg-neutral-100 text-neutral-500'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-[12.5px] ${i === step ? 'text-neutral-900 font-medium' : 'hum-muted'}`}>{s.label}</span>
            {i < stepsMeta.length - 1 && <span className="text-neutral-300 mx-2">›</span>}
          </div>
        ))}
      </div>

      <div className="p-6 space-y-5">
        {step === 0 && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="hum-h2">告诉我们关于你的企业</h2>
            <div className="grid grid-cols-3 gap-3">
              <WizardField label="员工规模" value={profile.size} options={['<30 人', '50-300 人', '300-1000 人', '>1000 人']}
                onChange={(v) => setProfile({ ...profile, size: v })} />
              <WizardField label="企业阶段" value={profile.stage} options={['产品验证期', '增长期', '成熟期', '上市后']}
                onChange={(v) => setProfile({ ...profile, stage: v })} />
              <WizardField label="所在行业" value={profile.industry} options={['SaaS / 企业服务', '电商 / 零售', '金融 / 保险', '制造业', '消费品牌', '其他']}
                onChange={(v) => setProfile({ ...profile, industry: v })} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="hum-h2">业务目标（多选）</h2>
            <p className="text-[12.5px] hum-muted">告诉我们最想用数字员工解决的问题，我们会匹配最合适的岗位。</p>
            <div className="grid grid-cols-2 gap-2">
              {['提升销售转化率', '降低运营成本', '加快新品上市', '提升客户 NPS', '合规风险管控', '产品质量保证', '招聘效率提升', '决策数据支撑'].map((g) => {
                const on = goals.includes(g);
                return (
                  <label key={g} className={`flex items-center gap-2 hum-card-soft p-3 cursor-pointer transition ${on ? 'border-primary-300 bg-primary-50' : ''}`}
                    style={{ border: on ? '1px solid var(--brand)' : '1px solid var(--border-subtle)' }}>
                    <input type="checkbox" checked={on} onChange={() => setGoals((p) => on ? p.filter((x) => x !== g) : [...p, g])} className="accent-primary-600" />
                    <span className="text-[12.5px] text-neutral-700">{g}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-3xl">
            <h2 className="hum-h2">选择需要覆盖的经营环节</h2>
            <p className="text-[12.5px] hum-muted">建议至少选 3-5 个环节，组成完整的责任链。</p>
            <div className="grid grid-cols-3 gap-2">
              {businessStages.map((s) => {
                const on = stages.includes(s.id);
                return (
                  <label key={s.id} className="hum-card-soft p-3 cursor-pointer transition"
                    style={{ border: on ? `2px solid ${s.color}` : '1px solid var(--border-subtle)', background: on ? `${s.color}0A` : undefined }}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={on} onChange={() => setStages((p) => on ? p.filter((x) => x !== s.id) : [...p, s.id])} className="accent-primary-600" />
                      <span className="hum-dot" style={{ background: s.color, width: 8, height: 8 }} />
                      <span className="text-[12.5px] font-medium text-neutral-900">{s.name}</span>
                    </div>
                    <div className="text-[11px] hum-muted mt-1 pl-6">{s.desc}</div>
                  </label>
                );
              })}
            </div>
            <div className="text-[11.5px] text-neutral-600">已选 {stages.length} 个环节</div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="hum-h2">推荐方案</h2>
            <div className="hum-card p-5 max-w-2xl"
              style={{ border: '2px solid var(--brand)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="hum-chip is-brand">最匹配</span>
                  <div className="text-[18px] font-semibold text-neutral-900 mt-1.5">{recommended.name}</div>
                  <div className="text-[12px] hum-muted">{recommended.subtitle}</div>
                </div>
                <div className="text-right">
                  <div className="text-[24px] font-bold text-neutral-900 hum-tabular">
                    {recommended.monthlyCost > 0 ? `¥${(recommended.monthlyCost / 1000).toFixed(1)}k` : '面议'}
                  </div>
                  {recommended.monthlyCost > 0 && <div className="text-[10.5px] hum-faint">/月</div>}
                </div>
              </div>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="hum-eyebrow mb-2">该套餐包含</div>
                <div className="grid grid-cols-2 gap-1.5 text-[12px]">
                  <div className="flex items-center gap-1.5"><Users size={11} className="text-primary-600" /> {recommended.agentCount} 位数字员工</div>
                  <div className="flex items-center gap-1.5"><Award size={11} className="text-secondary-600" /> 真人专家保底</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-success" /> 7 天试岗不满意可下架</div>
                  <div className="flex items-center gap-1.5"><Sparkles size={11} className="text-warning" /> Hermes 持续进化</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="hum-h2">预览部署</h2>
            <div className="grid grid-cols-3 gap-3 max-w-4xl">
              <div className="hum-card p-3">
                <div className="hum-eyebrow mb-1">企业画像</div>
                <div className="text-[12.5px]">{profile.size}</div>
                <div className="text-[12.5px]">{profile.stage}</div>
                <div className="text-[12.5px]">{profile.industry}</div>
              </div>
              <div className="hum-card p-3">
                <div className="hum-eyebrow mb-1">业务目标</div>
                <div className="space-y-0.5">
                  {goals.map((g) => <div key={g} className="text-[12px] text-neutral-700">· {g}</div>)}
                </div>
              </div>
              <div className="hum-card p-3">
                <div className="hum-eyebrow mb-1">经营环节</div>
                <div className="flex flex-wrap gap-1">
                  {stages.map((sid) => {
                    const s = businessStages.find((x) => x.id === sid);
                    return s ? <span key={sid} className="hum-chip" style={{ padding: '1px 6px', fontSize: 10, background: `${s.color}1A`, color: s.color, borderColor: `${s.color}33` }}>{s.name}</span> : null;
                  })}
                </div>
              </div>
            </div>
            <div className="hum-card p-4 max-w-4xl">
              <div className="hum-eyebrow mb-2">推荐方案</div>
              <div className="flex items-center gap-3">
                <div className="text-[18px] font-semibold">{recommended.name}</div>
                <span className="hum-chip is-brand">{recommended.agentCount} 人</span>
                <span className="text-[12.5px] hum-muted">{recommended.monthlyCost > 0 ? `¥${(recommended.monthlyCost / 1000).toFixed(1)}k / 月` : '面议'}</span>
              </div>
            </div>
            <p className="text-[12px] hum-muted max-w-2xl">
              点击 「一键部署」 后，方案会推送到「我的员工」，对应数字员工会出现在首页工位中。
              你可以随时进入 「我的员工」 → 调整权限、试岗、淘汰。
            </p>
          </div>
        )}
      </div>

      <div className="px-6 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="hum-btn"
        >
          上一步
        </button>
        <span className="flex-1" />
        <span className="text-[11.5px] hum-muted">第 {step + 1} / {stepsMeta.length} 步</span>
        {step < stepsMeta.length - 1 ? (
          <button onClick={() => setStep((s) => s + 1)} className="hum-btn is-primary">
            下一步 <ChevronRight size={12} />
          </button>
        ) : (
          <button onClick={() => onInstall(recommended.id)} className="hum-btn is-primary">
            一键部署 <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function WizardField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="hum-eyebrow mb-1.5">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="hum-input">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─────────── My hires tab ───────────
 * v9: 「我的招聘」改造为生命周期看板（试岗→评分→授权→入工区闭环），
 * UI 全部在 components/onboarding/LifecycleBoard.tsx，这里只做挂载。
 */

/* ─────────── Trial drawer ─────────── */
function TrialDrawer({ emp, onClose, onHire }: any) {
  const [taskInput, setTaskInput] = useState('帮我起草 1 封北辰金融 BD 邮件，要求 200 字以内 · 引用近 3 月互动');
  const [mockOutput, setMockOutput] = useState<string | null>(null);
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(15,15,14,0.5)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="hum-card w-[640px] max-w-[94vw] overflow-hidden"
        style={{ boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Sparkles size={16} className="text-secondary-600" />
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-neutral-900">体验工坊 · {emp.name}</div>
            <div className="text-[11px] hum-muted">{emp.tagline}</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="hum-eyebrow mb-1.5">业务任务</div>
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              rows={3}
              className="hum-input"
            />
          </div>
          {mockOutput && (
            <div className="hum-card-soft p-3">
              <div className="hum-eyebrow mb-1">模拟产出（体验版）</div>
              <pre className="text-[12px] text-neutral-800 whitespace-pre-wrap font-sans leading-relaxed">{mockOutput}</pre>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-warning">
                <Award size={11} /> 真实场景由 {emp.expert} 专家保底兜底
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMockOutput(`【主题】北辰金融 · Q3 战略合作沟通

赵总好：

借您 3 分钟。

近 3 个月我注意到您在金融科技投入板块新增了 4 条 PR 线索，对我们这边
的「企业级 Agent 编排能力」是个有趣的契合点。

我整理了一份针对北辰场景的方案要点（附件），其中第 2 节是为您组织
架构定制的责任链落点。

下周二上午是否方便 20 分钟会议？或者您指定时间。

— 雪 · ${emp.name}`);
              }}
              className="hum-btn"
            >
              <Sparkles size={12} /> 生成模拟产出
            </button>
            <span className="flex-1" />
            <button onClick={onHire} className="hum-btn is-primary">
              <ShoppingCart size={12} /> 满意 · 一键招聘
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
