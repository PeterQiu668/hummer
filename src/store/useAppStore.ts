import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ZoneId, Employee, ScreenView, RiskAlert, SkillSlotInEvent } from '../lib/types';
import { initialRiskAlerts } from '../data/tasks';
import { a2aHandoffPool } from '../data/executives';

interface CollabFeedItem {
  id: string;
  ts: string;
  channel: string;
  sender: string;
  avatar: string;
  senderRole: 'human' | 'manager' | 'worker' | 'hermes' | 'guardian';
  content: string;
  type: 'msg' | 'task' | 'approval' | 'alert' | 'evolution' | 'mention';
}

export type PageKey =
  | 'office'      // 默认 — 3D 办公室全景
  | 'chat'        // 对话流（全屏）
  | 'tasks'       // 工作任务 Kanban + 表格
  | 'employees'   // 我的员工
  | 'market'      // 员工市场（弹窗，但记进 history）
  | 'skills'      // 技能库
  | 'lobster'     // 练虾系统（modal）
  | 'connect'     // MCP / 应用
  | 'governance'  // HiClaw 治理舱（modal）
  | 'hermes'      // Hermes 进化（modal）
  | 'audit'       // 审计链
  | 'evidence'    // 证据库 / 产出物
  | 'kg';         // 企业知识中枢

export interface ToastItem {
  id: string;
  kind: 'success' | 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
  ts: number;
}

interface MCPApp {
  id: string;
  name: string;
  kind: string;
  connected: boolean;
  syncedAt?: string;
}

interface SkillState {
  id: string;
  enabled: boolean;
  installedAt: string;
}

interface AppState {
  // ───────── boot / screen ─────────
  screen: ScreenView;
  setScreen: (s: ScreenView) => void;
  bootDone: boolean;
  setBootDone: (v: boolean) => void;

  // ───────── navigation ─────────
  activePage: PageKey;
  setActivePage: (k: PageKey) => void;
  leftNav: string;
  setLeftNav: (k: string) => void;

  // ───────── office viewport ─────────
  activeZone: ZoneId | null;
  setActiveZone: (z: ZoneId | null) => void;

  // ───────── employee / drawer ─────────
  selectedEmployee: Employee | null;
  setSelectedEmployee: (e: Employee | null) => void;

  // ───────── modals ─────────
  showMarketplace: boolean;
  setShowMarketplace: (v: boolean) => void;
  showGovernance: boolean;
  setShowGovernance: (v: boolean) => void;
  showHermes: boolean;
  setShowHermes: (v: boolean) => void;
  showMeeting: boolean;
  setShowMeeting: (v: boolean) => void;
  showKG: boolean;
  setShowKG: (v: boolean) => void;
  showLobsterLab: boolean;
  setShowLobsterLab: (v: boolean) => void;

  // ───────── collab / IM ─────────
  activeChannel: string;
  setActiveChannel: (c: string) => void;
  riskAlerts: RiskAlert[];
  pendingApprovals: number;
  dismissAlert: (id: string) => void;
  approveAlert: (id: string, decision: 'approve' | 'reject', note?: string) => void;
  collabFeed: CollabFeedItem[];
  pushCollabMessage: (m: CollabFeedItem) => void;

  // ───────── skill slot-in animation ─────────
  slotIn: SkillSlotInEvent | null;
  triggerSlotIn: (e: { agentName: string; skillName: string; skillSource: string }) => void;
  clearSlotIn: () => void;

  // ───────── v6 persistence + mock runtime ─────────
  mcpApps: Record<string, MCPApp>;
  toggleMCP: (id: string) => void;
  upsertMCP: (app: MCPApp) => void;
  installedSkills: Record<string, SkillState>;
  toggleSkill: (id: string, enabled?: boolean) => void;
  installSkill: (id: string) => void;
  taskStatuses: Record<string, string>; // taskId -> status
  updateTaskStatus: (id: string, status: string) => void;
  tick: number; // mock runtime monotonic tick

  // ───────── audit log (persisted) ─────────
  auditLog: AuditEntry[];
  pushAudit: (entry: Omit<AuditEntry, 'id' | 'ts' | 'hash'>) => void;
  clearAudit: () => void;

  // ───────── toasts (transient) ─────────
  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, 'id' | 'ts'>) => void;
  dismissToast: (id: string) => void;

  // ───────── command palette ─────────
  cmdkOpen: boolean;
  setCmdkOpen: (v: boolean) => void;

  // ───────── executive twin detail ─────────
  activeExecId: string | null;
  setActiveExecId: (id: string | null) => void;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;          // 昆仑 / Agent name / system
  action: string;
  target: string;
  result: 'ok' | 'blocked' | 'pending' | 'warning';
  hash: string;
  tags?: string[];
}

// Default MCP catalog (used when persisted is empty)
const defaultMCPApps: Record<string, MCPApp> = {
  feishu:    { id: 'feishu',    name: '飞书',          kind: 'IM 协同',    connected: true,  syncedAt: '2 分钟前' },
  wework:    { id: 'wework',    name: '企业微信',      kind: 'IM 协同',    connected: true,  syncedAt: '7 分钟前' },
  wechat:    { id: 'wechat',    name: '个人微信',      kind: 'IM 协同',    connected: false },
  notion:    { id: 'notion',    name: 'Notion',       kind: '知识协同',    connected: true,  syncedAt: '1 小时前' },
  github:    { id: 'github',    name: 'GitHub',       kind: '研发协同',    connected: true,  syncedAt: '12 分钟前' },
  gdrive:    { id: 'gdrive',    name: 'Google Drive', kind: '文件存储',    connected: false },
  slack:     { id: 'slack',     name: 'Slack',        kind: 'IM 协同',    connected: false },
  postgres:  { id: 'postgres',  name: 'PostgreSQL',   kind: '数据库',     connected: true,  syncedAt: '3 分钟前' },
  salesforce:{ id: 'salesforce',name: 'Salesforce',   kind: 'CRM',       connected: true,  syncedAt: '24 分钟前' },
  mail:      { id: 'mail',      name: '企业邮箱',      kind: '通讯',       connected: true,  syncedAt: '5 分钟前' },
  chrome:    { id: 'chrome',    name: 'Chrome 浏览器', kind: '执行',       connected: false },
  kingdee:   { id: 'kingdee',   name: '金蝶 ERP',     kind: '企业系统',   connected: true,  syncedAt: '38 分钟前' },
};

const seedAudit: AuditEntry[] = [
  { id: 'au-1', ts: '14:35:12', actor: '雪·销售官',    action: '生成 BD 邮件草稿',  target: '鲲鹏制造',          result: 'ok',      hash: '0x4af2', tags: ['skill:bd_email_v3.2'] },
  { id: 'au-2', ts: '14:33:48', actor: 'Exec-Guardian', action: '阻断高危调拨',      target: '财务 138w',         result: 'blocked', hash: '0x9c01', tags: ['risk:high'] },
  { id: 'au-3', ts: '14:32:08', actor: '林·决策官',    action: '战略 A2A 下发',     target: '销售/运营/财务',     result: 'ok',      hash: '0x82e0', tags: ['protocol:a2a'] },
  { id: 'au-4', ts: '14:30:22', actor: '昆仑（您）',    action: '审批通过',          target: 'Q3 客户回访预算',    result: 'ok',      hash: '0xb44a', tags: ['human-in-loop'] },
  { id: 'au-5', ts: '14:28:51', actor: 'Hermes',       action: 'SOP 自动进化',     target: '资金调拨 v3 → v4',  result: 'pending', hash: '0x6e11', tags: ['evolution'] },
  { id: 'au-6', ts: '14:25:30', actor: '炅·研发官',    action: '创建 worktree',    target: 'fix/order-p1',     result: 'ok',      hash: '0xfa72', tags: ['mcp:gitlab.repo'] },
  { id: 'au-7', ts: '14:21:09', actor: '岚·运营官',    action: 'BI 查询',          target: 'gmv_618.sql',       result: 'ok',      hash: '0xd91a', tags: ['mcp:bi.warehouse'] },
  { id: 'au-8', ts: '14:18:00', actor: '律·法务官',    action: '调用 KG',          target: 'contract.risk_v3',  result: 'ok',      hash: '0x33ca', tags: ['kg'] },
];

const makeHash = () => '0x' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(4, '0');
const nowHHMM = () => new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
const nowHHMMSS = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      screen: 'boot',
      setScreen: (screen) => set({ screen }),
      bootDone: false,
      setBootDone: (bootDone) => set({ bootDone }),

      activePage: 'office',
      setActivePage: (activePage) => set({ activePage }),
      leftNav: 'office',
      setLeftNav: (leftNav) => set({ leftNav }),

      activeZone: null,
      setActiveZone: (activeZone) => set({ activeZone }),

      selectedEmployee: null,
      setSelectedEmployee: (selectedEmployee) => set({ selectedEmployee }),

      showMarketplace: false,
      setShowMarketplace: (showMarketplace) => set({ showMarketplace }),
      showGovernance: false,
      setShowGovernance: (showGovernance) => set({ showGovernance }),
      showHermes: false,
      setShowHermes: (showHermes) => set({ showHermes }),
      showMeeting: false,
      setShowMeeting: (showMeeting) => set({ showMeeting }),
      showKG: false,
      setShowKG: (showKG) => set({ showKG }),
      showLobsterLab: false,
      setShowLobsterLab: (showLobsterLab) => set({ showLobsterLab }),

      activeChannel: 'ch-q3',
      setActiveChannel: (activeChannel) => set({ activeChannel }),
      riskAlerts: initialRiskAlerts,
      pendingApprovals: initialRiskAlerts.filter((a) => a.status === 'pending').length,
      dismissAlert: (id) =>
        set((state) => {
          const next = state.riskAlerts.filter((a) => a.id !== id);
          return {
            riskAlerts: next,
            pendingApprovals: next.filter((a) => a.status === 'pending').length,
          };
        }),
      approveAlert: (id, decision, note) =>
        set((state) => {
          const target = state.riskAlerts.find((a) => a.id === id);
          const nextAlerts = state.riskAlerts.map((a) =>
            a.id === id
              ? { ...a, status: decision === 'approve' ? ('approved' as const) : ('rejected' as const) }
              : a,
          );
          const followup: CollabFeedItem | null = target
            ? {
                id: `rx-${id}-${Date.now()}`,
                ts: nowHHMM(),
                channel: target.channel,
                sender: '昆仑（您）',
                avatar: '昆',
                senderRole: 'human',
                content:
                  decision === 'approve'
                    ? `[OK] 昆仑批准了 · ${target.action}${note ? ` · ${note}` : ''}`
                    : `[X] 昆仑拒绝了 · ${target.action}${note ? ` · ${note}` : ' · 改为更安全方式'}`,
                type: 'approval',
              }
            : null;
          const auditEntry: AuditEntry = {
            id: `au-${Date.now()}`,
            ts: nowHHMMSS(),
            actor: '昆仑（您）',
            action: decision === 'approve' ? '审批通过' : '拒绝',
            target: target?.action ?? '未知',
            result: decision === 'approve' ? 'ok' : 'blocked',
            hash: makeHash(),
            tags: ['human-in-loop'],
          };
          return {
            riskAlerts: nextAlerts,
            pendingApprovals: nextAlerts.filter((a) => a.status === 'pending').length,
            collabFeed: followup ? [...state.collabFeed, followup] : state.collabFeed,
            auditLog: [auditEntry, ...state.auditLog].slice(0, 500),
          };
        }),
      collabFeed: [],
      pushCollabMessage: (m) =>
        set((state) => ({ collabFeed: [...state.collabFeed, m] })),

      slotIn: null,
      triggerSlotIn: (e) =>
        set({ slotIn: { id: `slot-${Date.now()}`, startedAt: Date.now(), ...e } }),
      clearSlotIn: () => set({ slotIn: null }),

      mcpApps: defaultMCPApps,
      toggleMCP: (id) =>
        set((state) => {
          const cur = state.mcpApps[id];
          if (!cur) return state;
          const next = { ...cur, connected: !cur.connected, syncedAt: !cur.connected ? '刚刚' : cur.syncedAt };
          const auditEntry: AuditEntry = {
            id: `au-${Date.now()}`,
            ts: nowHHMMSS(),
            actor: '昆仑（您）',
            action: next.connected ? '连接 MCP 应用' : '断开 MCP 应用',
            target: cur.name,
            result: 'ok',
            hash: makeHash(),
            tags: [`mcp:${id}`],
          };
          return {
            mcpApps: { ...state.mcpApps, [id]: next },
            auditLog: [auditEntry, ...state.auditLog].slice(0, 500),
          };
        }),
      upsertMCP: (app) =>
        set((state) => ({ mcpApps: { ...state.mcpApps, [app.id]: app } })),

      installedSkills: {},
      toggleSkill: (id, enabled) =>
        set((state) => {
          const cur = state.installedSkills[id];
          if (!cur) return state;
          return {
            installedSkills: {
              ...state.installedSkills,
              [id]: { ...cur, enabled: enabled ?? !cur.enabled },
            },
          };
        }),
      installSkill: (id) =>
        set((state) => ({
          installedSkills: {
            ...state.installedSkills,
            [id]: { id, enabled: true, installedAt: nowHHMMSS() },
          },
        })),

      taskStatuses: {},
      updateTaskStatus: (id, status) =>
        set((state) => ({ taskStatuses: { ...state.taskStatuses, [id]: status } })),

      tick: 0,

      auditLog: seedAudit,
      pushAudit: (entry) =>
        set((state) => {
          const full: AuditEntry = { id: `au-${Date.now()}`, ts: nowHHMMSS(), hash: makeHash(), ...entry };
          return { auditLog: [full, ...state.auditLog].slice(0, 500) };
        }),
      clearAudit: () => set({ auditLog: seedAudit }),

      toasts: [],
      pushToast: (t) =>
        set((state) => ({
          toasts: [...state.toasts, { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), ...t }],
        })),
      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

      cmdkOpen: false,
      setCmdkOpen: (cmdkOpen) => set({ cmdkOpen }),

      activeExecId: null,
      setActiveExecId: (activeExecId) => set({ activeExecId }),
    }),
    {
      name: 'hummer-v6',
      version: 1,
      // Only persist user-state, not transient UI state (toasts/modals/slot-in/drawer)
      partialize: (s) => ({
        activePage: s.activePage,
        leftNav: s.leftNav,
        mcpApps: s.mcpApps,
        installedSkills: s.installedSkills,
        taskStatuses: s.taskStatuses,
        auditLog: s.auditLog.slice(0, 60),  // cap on disk
        bootDone: s.bootDone,
      }) as any,
    },
  ),
);

// Mock runtime — pushes periodic events to make the system feel alive.
if (typeof window !== 'undefined') {
  const heartbeats: { sender: string; avatar: string; senderRole: CollabFeedItem['senderRole']; content: string; channel: string; type: CollabFeedItem['type'] }[] = [
    { sender: '雪·销售官',    avatar: '雪', senderRole: 'worker',   content: '已起草 1 封 BD 邮件，等待法务模板核验。', channel: 'ch-q3',      type: 'msg' },
    { sender: '岚·运营官',    avatar: '岚', senderRole: 'worker',   content: '618 复盘报告 v4.1 数据已回收，进入图表生成。', channel: 'ch-618',     type: 'msg' },
    { sender: 'Hermes',       avatar: '⟁', senderRole: 'hermes',   content: '检测到「合同审阅」回归测试通过，召回率 81% → 94%。', channel: 'ch-hermes', type: 'evolution' },
    { sender: '苓·客服官',    avatar: '苓', senderRole: 'worker',   content: '本小时已处理工单 28 条，升级 4 条至人工。', channel: 'ch-q3',      type: 'msg' },
    { sender: '炅·研发官',    avatar: '炅', senderRole: 'worker',   content: 'fix/order-p1 完成单测，等待主干合并审批。', channel: 'ch-q3',      type: 'task' },
  ];
  const auditPool: { actor: string; action: string; target: string; result: 'ok' | 'blocked' | 'pending' | 'warning'; tags: string[] }[] = [
    { actor: '雪·销售官', action: '调用 BD 邮件 v3.2',   target: '云海制药',          result: 'ok',      tags: ['skill', 'mcp:crm.salesforce'] },
    { actor: '苓·客服官', action: '调用情绪识别',         target: '工单 #2891',        result: 'ok',      tags: ['skill', 'mcp:ticket'] },
    { actor: '岚·运营官', action: 'BI 查询',              target: 'gmv_618.sql',       result: 'ok',      tags: ['mcp:bi.warehouse'] },
    { actor: '律·法务官', action: '合同条款匹配',         target: '主合同 v4',          result: 'warning', tags: ['skill', 'kg'] },
    { actor: 'Hermes',    action: 'SOP 进化',             target: '客服情绪 v2 → v3',   result: 'pending', tags: ['evolution'] },
  ];

  let beat = 0;
  setInterval(() => {
    useAppStore.setState((s) => ({ tick: s.tick + 1 }));
    beat += 1;
    // every 3 ticks (≈15s) push a collab message
    if (beat % 3 === 0) {
      const h = heartbeats[beat % heartbeats.length];
      const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
      useAppStore.setState((s) => ({
        collabFeed: [...s.collabFeed, {
          id: `mr-${Date.now()}`,
          ts, channel: h.channel,
          sender: h.sender, avatar: h.avatar, senderRole: h.senderRole,
          content: h.content, type: h.type,
        }].slice(-80),
      }));
    }
    // every 2 ticks (≈10s) push an audit entry
    if (beat % 2 === 0) {
      const a = auditPool[beat % auditPool.length];
      const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const hash = '0x' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(4, '0');
      useAppStore.setState((s) => ({
        auditLog: [{ id: `mr-au-${Date.now()}`, ts, hash, ...a }, ...s.auditLog].slice(0, 500),
      }));
    }
    // every 4 ticks (≈20s) push an A2A handoff into audit + chat
    if (beat % 4 === 0) {
      const h = a2aHandoffPool[beat % a2aHandoffPool.length];
      const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const ts5 = ts.slice(0, 5);
      const hash = '0x' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(4, '0');
      useAppStore.setState((s) => ({
        auditLog: [{
          id: `mr-a2a-${Date.now()}`, ts, hash,
          actor: h.fromLabel,
          action: 'A2A 委派',
          target: h.toLabel,
          result: 'ok' as const,
          tags: ['a2a', `intent:${h.intent.slice(0, 18)}`],
        }, ...s.auditLog].slice(0, 500),
        collabFeed: [...s.collabFeed, {
          id: `a2a-${Date.now()}`,
          ts: ts5, channel: h.channel,
          sender: h.fromLabel, avatar: h.fromLabel.slice(0, 1),
          senderRole: (h.fromId === 'boss' ? 'human' : 'manager') as 'human' | 'manager',
          content: `[A2A] 委派给 ${h.toLabel}：${h.intent}`,
          type: 'task' as const,
        }].slice(-100),
      }));
    }
  }, 5000);
}
