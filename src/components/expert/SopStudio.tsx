/**
 * 专家门户 · 共创工作台 — 生态闭环核心演示
 * SOP 步骤编辑 → 沙箱试跑（mock 2s）→ 评测达标 → 提交签名认证 → 上架
 */
import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, FlaskConical, Plus, Trash2, ChevronRight, Loader2,
  ShieldCheck, Coins, Target, Upload, Users,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { sopAssets, SOP_STATUS_LABEL, type SopAsset, type SopStatus } from '../../data/expertops';

interface SandboxResult {
  passRate: number;   // 任务通过率 %
  policy: number;     // 政策遵守 %
  cost: number;       // 单任务成本（元）
  qualified: boolean;
}

const STATUS_CHIP: Record<SopStatus, string> = {
  draft: '', sandbox: 'is-warning', review: 'is-brand', listed: 'is-success',
};

const PASS_THRESHOLD = 90;
const POLICY_THRESHOLD = 97;

function runSandboxMock(): SandboxResult {
  const passRate = Math.round((89 + Math.random() * 8) * 10) / 10;   // 89.0 - 97.0
  const policy = Math.round((96 + Math.random() * 4) * 10) / 10;     // 96.0 - 100.0
  const cost = Math.round((0.8 + Math.random() * 0.9) * 100) / 100;  // ¥0.80 - 1.70
  return { passRate, policy, cost, qualified: passRate >= PASS_THRESHOLD && policy >= POLICY_THRESHOLD };
}

export default function SopStudio() {
  const pushAudit = useAppStore((s) => s.pushAudit);
  const pushToast = useAppStore((s) => s.pushToast);

  const [assets, setAssets] = useState<SopAsset[]>(sopAssets);
  const [selectedId, setSelectedId] = useState<string>(sopAssets[0].id);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Record<string, SandboxResult>>({});
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  const selected = assets.find((a) => a.id === selectedId) ?? assets[0];
  const result = results[selected.id];
  const editable = selected.status === 'draft' || selected.status === 'sandbox';

  const patchAsset = (id: string, patch: Partial<SopAsset>) =>
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const updateStep = (idx: number, text: string) =>
    patchAsset(selected.id, { steps: selected.steps.map((s, i) => (i === idx ? text : s)) });
  const addStep = () =>
    patchAsset(selected.id, { steps: [...selected.steps, '新步骤：描述该步的输入 / 动作 / 产出与审批点'] });
  const removeStep = (idx: number) =>
    patchAsset(selected.id, { steps: selected.steps.filter((_, i) => i !== idx) });

  const runSandbox = () => {
    if (running) return;
    setRunning(true);
    setProgress(0);
    const id = selected.id;
    setResults((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    const started = Date.now();
    const tickTimer = window.setInterval(() => {
      setProgress(Math.min(100, Math.round(((Date.now() - started) / 2000) * 100)));
    }, 100);
    timers.current.push(window.setTimeout(() => {
      window.clearInterval(tickTimer);
      setProgress(100);
      const r = runSandboxMock();
      setResults((prev) => ({ ...prev, [id]: r }));
      setRunning(false);
      setAssets((prev) => prev.map((a) => (a.id === id && a.status === 'draft' ? { ...a, status: 'sandbox' } : a)));
      pushToast(r.qualified
        ? { kind: 'success', title: '沙箱试跑通过', detail: `任务通过率 ${r.passRate}% · 已达认证门槛，可提交上架` }
        : { kind: 'warning', title: '沙箱试跑未达标', detail: `通过率 ${r.passRate}%（需 ≥ ${PASS_THRESHOLD}%），请优化步骤后重试` });
    }, 2000));
  };

  const submitCertification = () => {
    const id = selected.id;
    const name = `${selected.name} ${selected.version}`;
    patchAsset(id, { status: 'review' });
    pushAudit({ actor: '林知远（专家）', action: 'SOP 提交签名认证', target: name, result: 'pending', tags: ['expert', 'sop', 'certify'] });
    pushToast({ kind: 'info', title: '已提交签名认证', detail: `${name} · 平台认证委员会复核中` });
    // mock：2.5s 后认证通过并上架
    timers.current.push(window.setTimeout(() => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'listed', hires: a.hires || 1 } : a)));
      pushAudit({ actor: '平台认证委员会', action: 'SOP 认证通过并上架', target: name, result: 'ok', tags: ['expert', 'sop', 'listed'] });
      pushToast({ kind: 'success', title: '认证通过，已上架', detail: `${name} 已进入员工市场，带专家签名徽标` });
    }, 2500));
  };

  return (
    <div className="p-6 flex gap-4 max-w-6xl mx-auto items-start">
      {/* 左：我的 SOP 资产 */}
      <div className="w-72 shrink-0 space-y-2">
        <div className="hum-eyebrow px-1">我的 SOP 资产 · {assets.length}</div>
        {assets.map((a) => {
          const active = a.id === selectedId;
          return (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className="w-full text-left hum-card p-3 transition"
              style={active ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 1px var(--brand)' } : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-neutral-900 truncate flex-1">{a.name}</span>
                {a.status === 'listed' && <BadgeCheck size={13} className="text-success shrink-0" />}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="hum-chip is-muted font-mono">{a.version}</span>
                <span className={`hum-chip ${STATUS_CHIP[a.status]}`}>{SOP_STATUS_LABEL[a.status]}</span>
                {a.status === 'listed' && (
                  <span className="text-[10.5px] hum-faint ml-auto hum-tabular">{a.hires} 家在雇</span>
                )}
              </div>
            </button>
          );
        })}
        {/* 状态流转说明 */}
        <div className="hum-card-soft p-3 text-[11px] hum-muted leading-relaxed">
          流转：草稿 <ChevronRight size={10} className="inline" /> 沙箱试跑 <ChevronRight size={10} className="inline" /> 签名认证 <ChevronRight size={10} className="inline" /> 上架分成
        </div>
      </div>

      {/* 右：编辑视图 */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="hum-card p-4 hum-elev-1">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="hum-h2">{selected.name}</h2>
                <span className="hum-chip is-muted font-mono">{selected.version}</span>
                <span className={`hum-chip ${STATUS_CHIP[selected.status]}`}>{SOP_STATUS_LABEL[selected.status]}</span>
              </div>
              <p className="mt-1 text-[12.5px] hum-muted">{selected.desc} · 更新于 {selected.updatedAt}</p>
            </div>
            {selected.status === 'listed' && (
              <div className="shrink-0 flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--success-soft)' }}>
                <BadgeCheck size={18} className="text-success" />
                <div>
                  <div className="text-[12px] font-semibold text-success">林知远 · 签名认证</div>
                  <div className="text-[11px] hum-muted flex items-center gap-1"><Users size={11} /> {selected.hires} 家企业在雇</div>
                </div>
              </div>
            )}
          </div>

          {/* 步骤编辑器 */}
          <div className="mt-4 space-y-2">
            <div className="hum-eyebrow">SOP 步骤 · {selected.steps.length}</div>
            {selected.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 h-6 shrink-0 grid place-items-center rounded-md text-[11px] font-semibold font-mono" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                  {i + 1}
                </span>
                <input
                  value={step}
                  disabled={!editable}
                  onChange={(e) => updateStep(i, e.target.value)}
                  className="hum-input disabled:opacity-60"
                />
                {editable && (
                  <button
                    onClick={() => removeStep(i)}
                    className="p-1.5 rounded-md text-neutral-400 hover:text-error hover:bg-neutral-100 transition"
                    title="删除步骤"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {editable ? (
              <button className="hum-btn is-ghost is-sm" onClick={addStep}><Plus size={12} /> 添加步骤</button>
            ) : (
              <div className="text-[11.5px] hum-faint">
                {selected.status === 'review' ? '认证复核中，步骤已锁定' : '已上架版本步骤只读 · 修订请创建新版本'}
              </div>
            )}
          </div>

          {/* 沙箱试跑 */}
          {editable && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {running ? (
                <div>
                  <div className="flex items-center gap-2 text-[12.5px] hum-muted">
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--brand)' }} />
                    沙箱评测运行中 · 回放 200 条历史任务样本 · {progress}%
                  </div>
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--brand)' }} />
                  </div>
                </div>
              ) : (
                <button className="hum-btn is-sm" onClick={runSandbox}>
                  <FlaskConical size={13} /> 沙箱试跑
                </button>
              )}
            </div>
          )}
        </div>

        {/* 评测结果卡 */}
        {result && !running && (
          <div className="hum-card p-4 hum-elev-1">
            <div className="flex items-center gap-2">
              <div className="hum-h3">沙箱评测结果</div>
              <span className={`hum-chip ${result.qualified ? 'is-success' : 'is-error'}`}>
                {result.qualified ? '达标 · 可提交认证' : '未达标'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <MetricCell icon={<Target size={13} />} label="任务通过率" value={`${result.passRate}%`} sub={`门槛 ≥ ${PASS_THRESHOLD}%`} ok={result.passRate >= PASS_THRESHOLD} />
              <MetricCell icon={<ShieldCheck size={13} />} label="政策遵守" value={`${result.policy}%`} sub={`门槛 ≥ ${POLICY_THRESHOLD}%`} ok={result.policy >= POLICY_THRESHOLD} />
              <MetricCell icon={<Coins size={13} />} label="单任务成本" value={`¥${result.cost.toFixed(2)}`} sub="200 条样本均值" ok />
            </div>
            {result.qualified ? (
              <button className="hum-btn is-primary is-sm mt-3" onClick={submitCertification}>
                <Upload size={13} /> 提交认证上架
              </button>
            ) : (
              <div className="mt-3 text-[12px]" style={{ color: 'var(--error)' }}>
                未达认证门槛：请优化步骤（补充审批点 / 收窄数据范围）后重新试跑。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCell({ icon, label, value, sub, ok }: {
  icon: React.ReactNode; label: string; value: string; sub: string; ok: boolean;
}) {
  return (
    <div className="hum-card-soft p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium hum-muted">{icon} {label}</div>
      <div className="mt-1 text-[20px] font-semibold hum-tabular" style={{ color: ok ? 'var(--success)' : 'var(--error)' }}>
        {value}
      </div>
      <div className="text-[10.5px] hum-faint mt-0.5">{sub}</div>
    </div>
  );
}
