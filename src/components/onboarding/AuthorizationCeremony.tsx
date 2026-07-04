/**
 * 授权仪式（Phase 0 缺口⑩ · 信任闭环关键页）
 * 数字员工转正时的全屏签署页，四区：
 * ① 权限清单（可勾选） ② 数据范围 ③ 月度动作额度（超限熔断转人工） ④ 有效期
 * 确认签署 → addGrant（store 内写审计）→ 成功态（grant 编号 + 审计 hash）→ 卡片变 onboarded。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, ShieldCheck, Database, Gauge, CalendarClock, BadgeCheck,
  Fingerprint, Lock, AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  grantPermissionOptions, grantDataScopes,
  QUOTA_DEFAULT, QUOTA_MIN, QUOTA_MAX, QUOTA_STEP,
  VALIDITY_OPTIONS, VALIDITY_DEFAULT, validUntilFromDays,
  type CandidateView,
} from '../../data/trial';

const SIGNER = '昆仑（您）';

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`;

function SectionTitle({ icon, num, title, desc }: { icon: React.ReactNode; num: string; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-8 h-8 rounded-lg bg-primary-50 grid place-items-center text-primary-700 shrink-0">{icon}</div>
      <div>
        <div className="text-[13px] font-semibold text-neutral-900">
          <span className="hum-faint font-mono text-[11px] mr-1.5">{num}</span>{title}
        </div>
        <div className="text-[11px] hum-muted">{desc}</div>
      </div>
    </div>
  );
}

export default function AuthorizationCeremony({ view, onClose }: { view: CandidateView; onClose: () => void }) {
  const addGrant = useAppStore((s) => s.addGrant);
  const pushToast = useAppStore((s) => s.pushToast);

  const { emp } = view;
  const [perms, setPerms] = useState<Record<string, boolean>>(
    () => Object.fromEntries(grantPermissionOptions.map((p) => [p.id, p.defaultOn])),
  );
  const [quota, setQuota] = useState(QUOTA_DEFAULT);
  const [validity, setValidity] = useState(VALIDITY_DEFAULT);
  const [signed, setSigned] = useState<{ grantId: string; hash: string; validUntil: string } | null>(null);

  const checkedPerms = grantPermissionOptions.filter((p) => perms[p.id]);

  const handleSign = () => {
    const validUntil = validUntilFromDays(validity);
    addGrant({
      employeeId: emp.id,
      employeeName: emp.name,
      permissions: checkedPerms.map((p) => p.label),
      dataScope: grantDataScopes.map((d) => `${d.name} · ${d.level}`),
      quotaMonthly: quota,
      validUntil,
      signedBy: SIGNER,
    });
    const st = useAppStore.getState();
    setSigned({
      grantId: st.grants[0]?.id ?? 'grant-unknown',
      hash: st.auditLog[0]?.hash ?? '0x0000',
      validUntil,
    });
    pushToast({ kind: 'success', title: `${emp.name} 已正式入职`, detail: `授权已签署 · 月度额度 ${fmtMoney(quota)} · 有效期 ${validity} 天` });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[80] grid place-items-center p-6"
      style={{ background: 'rgba(15,15,14,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={signed ? onClose : undefined}
    >
      <motion.div
        initial={{ y: 24, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ duration: 0.28 }}
        className="bg-white rounded-xl w-[880px] max-w-[96vw] max-h-[92vh] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {signed ? (
          /* ───────── 成功态 ───────── */
          <div className="p-10 text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}
              className="w-16 h-16 rounded-full mx-auto grid place-items-center"
              style={{ background: 'var(--success-soft)' }}
            >
              <BadgeCheck size={30} className="text-success" />
            </motion.div>
            <h2 className="hum-h1 mt-4">{emp.name} 已正式入职</h2>
            <p className="text-[13px] hum-muted mt-1.5">授权协议已签署并写入审计链 · 数字员工进入工区开始履职</p>

            <div className="hum-card-soft mt-6 mx-auto max-w-[560px] p-4 text-left space-y-2.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="hum-muted flex items-center gap-1.5"><Fingerprint size={13} /> 授权编号</span>
                <span className="font-mono text-neutral-900">{signed.grantId}</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="hum-muted flex items-center gap-1.5"><Lock size={13} /> 审计签名 Hash</span>
                <span className="font-mono text-primary-700">{signed.hash}</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="hum-muted">签署人 / 时间</span>
                <span className="text-neutral-900">{SIGNER} · 刚刚</span>
              </div>
              <div className="hum-divider" />
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="hum-muted">权限 {checkedPerms.length} 项 · 月度额度</span>
                <span className="text-neutral-900 hum-tabular">{fmtMoney(quota)} / 月</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="hum-muted">有效期至</span>
                <span className="text-neutral-900 hum-tabular">{signed.validUntil}（{validity} 天）</span>
              </div>
            </div>

            <button onClick={onClose} className="hum-btn is-primary mt-7 px-8 py-2.5 mx-auto">
              完成 · 查看生命周期看板
            </button>
          </div>
        ) : (
          /* ───────── 签署态 ───────── */
          <>
            <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-lg grid place-items-center text-white font-bold" style={{ background: emp.color }}>
                {emp.avatar}
              </div>
              <div className="flex-1">
                <h1 className="hum-h2 flex items-center gap-2">
                  授权仪式 · {emp.name}
                  <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>
                    <ShieldCheck size={10} /> 转正签署
                  </span>
                </h1>
                <p className="text-[11.5px] hum-muted mt-0.5">
                  试岗评分 {view.cand.trialScore} · {emp.expert} 共创认证 · 签署后权限与额度即刻生效，全程审计留痕
                </p>
              </div>
              <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-5">
              {/* ① 权限清单 */}
              <div className="hum-card p-4">
                <SectionTitle icon={<ShieldCheck size={15} />} num="01" title="权限清单" desc={`勾选授予的动作权限 · 已选 ${checkedPerms.length}/${grantPermissionOptions.length}`} />
                <div className="space-y-1.5">
                  {grantPermissionOptions.map((p) => {
                    const on = !!perms[p.id];
                    return (
                      <label
                        key={p.id}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition"
                        style={{ border: on ? '1px solid var(--brand)' : '1px solid var(--border-subtle)', background: on ? 'var(--brand-soft)' : 'var(--bg-canvas)' }}
                      >
                        <input
                          type="checkbox" checked={on}
                          onChange={() => setPerms((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                          className="accent-primary-600 mt-0.5"
                        />
                        <div>
                          <div className="text-[12.5px] font-medium text-neutral-900">{p.label}</div>
                          <div className="text-[10.5px] hum-muted mt-0.5">{p.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-5">
                {/* ② 数据范围 */}
                <div className="hum-card p-4">
                  <SectionTitle icon={<Database size={15} />} num="02" title="数据范围" desc="数字员工可触达的数据边界" />
                  <div className="space-y-1.5">
                    {grantDataScopes.map((d) => (
                      <div key={d.name} className="flex items-center justify-between px-2.5 py-2 rounded-lg hum-card-soft">
                        <span className="text-[12.5px] text-neutral-900">{d.name}</span>
                        <span
                          className={`hum-chip ${d.level === '无权限' ? 'is-error' : d.level.includes('审批') ? 'is-warning' : ''}`}
                          style={{ padding: '1px 8px', fontSize: 10.5 }}
                        >
                          {d.level}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ③ 月度动作额度 */}
                <div className="hum-card p-4">
                  <SectionTitle icon={<Gauge size={15} />} num="03" title="月度动作额度" desc="邮件外发 / 报价 / 采购等动作累计金额上限" />
                  <div className="flex items-baseline gap-2">
                    <span className="text-[26px] font-bold text-neutral-900 hum-tabular">{fmtMoney(quota)}</span>
                    <span className="text-[11px] hum-faint">/ 月</span>
                  </div>
                  <input
                    type="range" min={QUOTA_MIN} max={QUOTA_MAX} step={QUOTA_STEP}
                    value={quota} onChange={(e) => setQuota(Number(e.target.value))}
                    className="w-full mt-2 accent-primary-600"
                  />
                  <div className="flex justify-between text-[10px] hum-faint mt-0.5">
                    <span>{fmtMoney(QUOTA_MIN)}</span><span>{fmtMoney(QUOTA_MAX)}</span>
                  </div>
                  <div className="mt-2.5 flex items-start gap-1.5 text-[10.5px] text-warning">
                    <AlertTriangle size={11} className="mt-px shrink-0" />
                    超出额度的动作将被自动熔断并转人工审批，同时通知您与守护 Agent
                  </div>
                </div>

                {/* ④ 有效期 */}
                <div className="hum-card p-4">
                  <SectionTitle icon={<CalendarClock size={15} />} num="04" title="授权有效期" desc="到期自动失效，需重新签署续期" />
                  <div className="grid grid-cols-4 gap-1.5">
                    {VALIDITY_OPTIONS.map((d) => (
                      <button
                        key={d}
                        onClick={() => setValidity(d)}
                        className={`py-2 rounded-lg text-[12px] font-medium transition ${validity === d ? 'text-white' : 'hum-card-soft text-neutral-700 hover:text-neutral-900'}`}
                        style={validity === d ? { background: 'var(--brand)' } : undefined}
                      >
                        {d} 天
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] hum-muted mt-2 hum-tabular">有效期至 {validUntilFromDays(validity)}</div>
                </div>
              </div>
            </div>

            {/* 签署底栏 */}
            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-canvas)' }}>
              <button
                onClick={handleSign}
                disabled={checkedPerms.length === 0}
                className="hum-btn is-primary w-full justify-center py-3 text-[14px]"
                style={checkedPerms.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                <Fingerprint size={16} />
                我已知晓责任归属，确认签署（{checkedPerms.length} 项权限 · {fmtMoney(quota)}/月 · {validity} 天）
              </button>
              <div className="text-[10.5px] hum-faint text-center mt-2">
                签署人对授权范围内的动作承担最终责任 · 签署记录与 hash 将写入不可篡改审计链
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
