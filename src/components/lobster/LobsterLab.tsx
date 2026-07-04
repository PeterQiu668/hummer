/**
 * 练虾系统 Lobster Lab (v7 浅色重写)
 * 抖音 3 视频 5 大机制：
 *   - 老板今日待办
 *   - SOP 版本演进
 *   - 黑客帝国式技能插盘
 *   - 淘汰流（拒绝慢养）
 *   - 上岗 4 阶段生命周期
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, ScrollText, Zap, Inbox, Skull, Workflow,
  CheckCircle2, AlertTriangle, Clock, ArrowRight, TrendingUp, TrendingDown,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { employees } from '../../data/employees';
import { marketEmployees } from '../../data/marketplace';
import {
  sopVersions, inboxItems, eliminatedAgents, lifecycleCandidates,
  LIFECYCLE_STAGES, INBOX_KINDS,
} from '../../data/douyin';

type Tab = 'sop' | 'skill' | 'inbox' | 'eliminated' | 'lifecycle';

const tabs: { id: Tab; label: string; icon: typeof Inbox; color: string; from: string }[] = [
  { id: 'inbox',      label: '老板今日待办', icon: Inbox,      color: '#0F70B7', from: '视频② AI 飞书' },
  { id: 'sop',        label: 'SOP 版本演进', icon: ScrollText, color: '#7E22CE', from: '视频① 4 要素' },
  { id: 'skill',      label: '黑客帝国插盘', icon: Zap,        color: '#0F766E', from: '视频① 上岗机制' },
  { id: 'eliminated', label: '淘汰流',       icon: Skull,      color: '#C13D3D', from: '视频① 拒绝慢养' },
  { id: 'lifecycle',  label: '上岗 4 阶段',  icon: Workflow,   color: '#B07706', from: '视频③ 量产范式' },
];

export default function LobsterLab() {
  const setShowLobsterLab = useAppStore((s) => s.setShowLobsterLab);
  const triggerSlotIn = useAppStore((s) => s.triggerSlotIn);
  const [tab, setTab] = useState<Tab>('inbox');
  const active = tabs.find((t) => t.id === tab)!;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex"
      style={{ background: 'rgba(15,15,14,0.32)', backdropFilter: 'blur(4px)' }}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="m-6 flex-1 bg-white rounded-xl overflow-hidden flex flex-col"
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3 bg-gradient-to-r from-primary-50 via-white to-secondary-50"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="text-2xl">🦞</div>
          <div className="flex-1">
            <h1 className="hum-h1 text-[20px]">练虾系统 · Lobster Lab</h1>
            <p className="text-[11.5px] hum-muted mt-0.5 font-mono tracking-wide">
              FROM DOUYIN 3 VIDEOS · 5 MECHANISMS INJECTED
            </p>
          </div>
          <span className="hum-chip is-brand">v5.5 · 抖音机制注入</span>
          <button
            onClick={() => setShowLobsterLab(false)}
            className="text-neutral-400 hover:text-neutral-900 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-3 flex items-center gap-1 bg-neutral-25"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition"
                style={{
                  background: isActive ? t.color : 'transparent',
                  color: isActive ? 'white' : 'var(--text-muted)',
                  border: `1px solid ${isActive ? t.color : 'transparent'}`,
                }}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
          <div className="flex-1" />
          <span className="text-[10.5px] font-mono text-neutral-500">来源 · {active.from}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-neutral-25">
          {tab === 'inbox' && <InboxView />}
          {tab === 'sop' && <SopView />}
          {tab === 'skill' && <SkillView onSlot={triggerSlotIn} />}
          {tab === 'eliminated' && <EliminatedView />}
          {tab === 'lifecycle' && <LifecycleView />}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────── INBOX (视频②) ───────────────────────
function InboxView() {
  const groups = INBOX_KINDS.map((k) => ({
    ...k,
    items: inboxItems.filter((i) => i.kind === k.id),
  }));
  return (
    <div className="grid grid-cols-5 gap-3 h-full">
      {groups.map((g) => (
        <div key={g.id} className="bg-white rounded-lg flex flex-col overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}>
          <div className="px-3 py-2 text-[11.5px] font-medium tracking-wider flex items-center justify-between"
            style={{ background: `${g.color}10`, color: g.color, borderBottom: `1px solid ${g.color}30` }}>
            <span>{g.label}</span>
            <span className="font-mono text-[10px]">{g.items.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {g.items.length === 0 && (
              <div className="text-[10.5px] text-neutral-400 italic px-2 py-4 text-center">清空</div>
            )}
            {g.items.map((it) => (
              <div key={it.id}
                className="rounded-md p-2 hover:hum-elev-1 transition cursor-pointer group"
                style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-start gap-1.5">
                  {it.urgent && <AlertTriangle size={11} className="text-error mt-0.5 shrink-0 hum-pulse" />}
                  <div className="text-[12px] font-medium text-neutral-900 leading-tight">{it.title}</div>
                </div>
                <div className="text-[10px] text-neutral-500 mt-1 font-mono">
                  {it.agent} · {it.channel} · {it.ts}
                </div>
                <div className="text-[11px] text-neutral-600 mt-1.5 leading-snug">{it.detail}</div>
                <div className="mt-2 flex items-center gap-1">
                  <button className="hum-btn is-sm">处理</button>
                  <button className="hum-btn is-sm">转交</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────── SOP 版本演进 (视频①) ───────────────────────
function SopView() {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  return (
    <div className="space-y-3">
      <div className="text-[12.5px] text-neutral-600 mb-4 px-1 leading-relaxed">
        每个数字员工的 SOP 都有完整版本号 + 训练轮次 + 准确率曲线。
        <b className="text-neutral-900"> SOP 是资产，不是 prompt。</b>
        Hermes 进化产生新版本，沙箱评测通过后入库。
      </div>
      {sopVersions.map((sv) => {
        const emp = empMap.get(sv.agentId);
        if (!emp) return null;
        const latest = sv.history[0];
        const prev = sv.history[1];
        const delta = prev ? latest.accuracy - prev.accuracy : 0;
        return (
          <div key={sv.agentId} className="bg-white rounded-lg p-4 flex gap-4"
            style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="w-12 h-12 rounded-lg grid place-items-center text-white font-bold text-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, #0F70B7, #7E22CE)' }}>
              {emp.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold text-neutral-900">{emp.name}</span>
                <span className="text-[10.5px] text-neutral-500">{emp.role}</span>
                <span className="hum-chip is-brand" style={{ padding: '1px 6px', fontSize: 10 }}>SOP {sv.current}</span>
                <span className="text-[10.5px] text-neutral-500">{sv.trainedRounds} 轮训练</span>
                <span className="text-[10.5px] text-neutral-500">上次升级 {sv.lastBumpAt}</span>
                <span className="flex-1" />
                <span className="flex items-center gap-1 text-[11.5px] font-mono"
                  style={{ color: delta > 0 ? '#1E8F5C' : delta < 0 ? '#C13D3D' : '#6B6B65' }}>
                  {delta > 0 && <TrendingUp size={11} />}
                  {delta < 0 && <TrendingDown size={11} />}
                  {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3 flex items-end gap-2 h-12">
                {sv.history.slice().reverse().map((h) => (
                  <div key={h.round} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-sm transition-all"
                      style={{
                        height: `${(h.accuracy / 100) * 40}px`,
                        background: h === latest ? '#7E22CE' : '#E5E5E5',
                        minHeight: 3,
                      }}
                      title={`${h.version} · ${h.accuracy}%`} />
                    <div className="text-[8.5px] font-mono text-neutral-500">{h.version}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11.5px] text-neutral-700">
                <span className="text-secondary-700 font-medium">最新版备注：</span>{latest.note}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────── SKILL 插盘 (视频①) ───────────────────────
function SkillView({ onSlot }: { onSlot: (e: any) => void }) {
  const skillBank = [
    { skill: 'BD 邮件 v3.2',    source: '陈鹏 (前 SaaS 销售总监)', target: '雪·销售官', desc: '回复率 8.2% → 26.6%' },
    { skill: '私域 SOP v2',     source: '李婷 (私域操盘手)',        target: '雪·销售官', desc: '微信触达 +5w/月' },
    { skill: '618 复盘 v4.1',  source: '吴琳 (前阿里大促)',        target: '岚·运营官', desc: 'GMV +2.3x' },
    { skill: '合同审阅 v2.7',  source: '黄律 (红圈所合伙人)',      target: '律·法务官', desc: '召回率 81% → 94%' },
    { skill: '情绪识别 v3',     source: '柳菲 (前美团客服中台)',    target: '苓·客服官', desc: 'NPS +21' },
    { skill: '差旅自动化',      source: '简文 (差旅 SaaS)',        target: '荷·人事官', desc: '比价 -18%' },
  ];
  return (
    <div>
      <div className="text-[12.5px] text-neutral-600 mb-4 px-1 leading-relaxed">
        像 Neo 在《黑客帝国》里学功夫 — 点击「插盘上岗」即时把专家共创的技能注入员工，沙箱试跑后入库。
        <b className="text-neutral-900">不是 prompt 工程，是技能即插即用。</b>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {skillBank.map((s, i) => (
          <div key={i} className="bg-white rounded-lg p-4 hover:hum-elev-2 transition group"
            style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-neutral-900">{s.skill}</div>
                <div className="text-[11.5px] text-neutral-500 mt-1">{s.source}</div>
              </div>
              <span className="hum-chip is-success" style={{ padding: '1px 6px', fontSize: 10 }}>SIGNED</span>
            </div>
            <div className="text-[12px] text-tertiary-700 mt-2 font-mono">↗ {s.desc}</div>
            <div className="mt-3 pt-3 flex items-center gap-2"
              style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-[11.5px] text-neutral-600">目标：{s.target}</span>
              <div className="flex-1" />
              <button
                onClick={() => onSlot({ agentName: s.target, skillName: s.skill, skillSource: s.source })}
                className="hum-btn is-sm is-primary"
              >
                <Zap size={11} /> 插盘上岗
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────── 淘汰流 (视频①) ───────────────────────
function EliminatedView() {
  return (
    <div>
      <div className="text-[12.5px] text-neutral-600 mb-4 px-1 leading-relaxed">
        <b className="text-neutral-900">拒绝慢养</b> — Agent 在练虾池里高强度试岗，不达标的下架。下面这 4 位是被替换的失败 Agent：
      </div>
      <div className="space-y-2">
        {eliminatedAgents.map((el) => (
          <div key={el.id} className="bg-white rounded-lg p-4 flex items-center gap-4"
            style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="w-12 h-12 rounded-lg bg-error/10 grid place-items-center text-error shrink-0"
              style={{ border: '1px solid rgba(193, 61, 61, 0.30)' }}>
              <Skull size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] text-neutral-500 line-through">{el.name}</span>
                <span className="hum-chip is-error" style={{ padding: '1px 6px', fontSize: 10 }}>已淘汰 {el.eliminatedAt}</span>
                <span className="text-[10.5px] text-neutral-500">尝试 {el.tasksTried} 次 · 终评 {el.finalScore}/100</span>
              </div>
              <div className="text-[11.5px] text-neutral-700 mt-1">
                <span className="text-error">淘汰原因：</span>{el.reason}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ArrowRight size={14} className="text-neutral-400" />
              <div className="text-right">
                <div className="text-[10.5px] text-neutral-500">替换为</div>
                <div className="text-[13px] font-semibold text-success">{el.replacedBy}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 hum-card-soft p-3 text-[11.5px] text-neutral-600">
        累计淘汰 <b className="text-neutral-900">{eliminatedAgents.length}</b> 位 ·
        累计替换为更强的命名 Agent，整体团队基线 +<b className="text-success">34%</b>
      </div>
    </div>
  );
}

// ─────────────────────── 上岗 4 阶段 (视频③) ───────────────────────
function LifecycleView() {
  const marketMap = new Map(marketEmployees.map((m) => [m.id, m]));
  return (
    <div>
      <div className="text-[12.5px] text-neutral-600 mb-4 px-1 leading-relaxed">
        <b className="text-neutral-900">量产范式</b> — 专家共创的员工不是直接上岗，要走 4 阶段：在市场 → 沙箱试岗 → 评分 → 授权配置 → 入工区。每阶段都有人审节点。
      </div>
      <div className="grid grid-cols-5 gap-3">
        {LIFECYCLE_STAGES.map((st) => {
          const items = lifecycleCandidates.filter((c) => c.stage === st.id);
          return (
            <div key={st.id} className="bg-white rounded-lg flex flex-col overflow-hidden"
              style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="px-3 py-2 text-[11.5px] font-medium tracking-wider flex items-center justify-between"
                style={{ background: `${st.color}10`, color: st.color, borderBottom: `1px solid ${st.color}30` }}>
                <span>{st.label}</span>
                <span className="font-mono text-[10px]">{items.length}</span>
              </div>
              <div className="flex-1 p-2 space-y-2">
                {items.map((c) => {
                  const m = marketMap.get(c.marketId);
                  if (!m) return null;
                  return (
                    <div key={c.marketId} className="rounded-md p-2"
                      style={{ border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md grid place-items-center text-white font-bold text-xs shrink-0"
                          style={{ background: m.color }}>
                          {m.avatar}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11.5px] font-medium text-neutral-900 truncate">{m.name}</div>
                          <div className="text-[9.5px] text-neutral-500 truncate">{m.category}</div>
                        </div>
                      </div>
                      {c.stage === 'trial' && c.trialDay && (
                        <div className="mt-1.5 text-[10.5px] flex items-center gap-1" style={{ color: st.color }}>
                          <Clock size={9} /> 第 {c.trialDay}/7 天
                        </div>
                      )}
                      {c.trialScore != null && (
                        <div className="mt-1.5">
                          <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                            <div className="h-full rounded-full"
                              style={{
                                width: `${c.trialScore}%`,
                                background: c.trialScore >= 80 ? '#1E8F5C' : c.trialScore >= 60 ? '#B07706' : '#C13D3D',
                              }} />
                          </div>
                          <div className="text-[9.5px] font-mono text-neutral-500 mt-0.5">评分 {c.trialScore}/100</div>
                        </div>
                      )}
                      {c.trialMetrics && (
                        <div className="mt-1.5 grid grid-cols-2 gap-1 text-[9.5px] font-mono text-neutral-500">
                          <span>完成 {c.trialMetrics.completed}</span>
                          <span>质量 {c.trialMetrics.quality}</span>
                          <span>成本 {c.trialMetrics.cost}</span>
                          <span className={c.trialMetrics.risks > 0 ? 'text-error' : ''}>风险 {c.trialMetrics.risks}</span>
                        </div>
                      )}
                      {c.stage === 'onboarded' && c.expectedZone && (
                        <div className="mt-1.5 text-[9.5px] flex items-center gap-1 text-success">
                          <CheckCircle2 size={9} /> 已入 {c.expectedZone}
                        </div>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="text-[10.5px] text-neutral-400 italic text-center py-3">空</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
