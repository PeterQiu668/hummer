import { useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  BrainCircuit,
  Check,
  KeyRound,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useAppStore, type PersonalSettings } from '../../store/useAppStore';
import { browserEngineProfiles, engineProfileForLabel, listEngineProfiles, type CustomerEngineProfile } from '../engines/engineProfileClient';
import { configureEngineCredential, hasEngineCredentialBridge, removeEngineCredential } from '../engines/engineCredentialClient';

export default function MySettingsDrawer() {
  const settings = useAppStore((state) => state.personalSettings);
  const updateSettings = useAppStore((state) => state.updatePersonalSettings);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const pushToast = useAppStore((state) => state.pushToast);
  const [draft, setDraft] = useState(settings);
  const [engineProfiles, setEngineProfiles] = useState<readonly CustomerEngineProfile[]>(browserEngineProfiles);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [credentialBusy, setCredentialBusy] = useState<string | null>(null);
  const selectedProfile = engineProfileForLabel(engineProfiles, draft.preferredModel);

  useEffect(() => {
    let active = true;
    void listEngineProfiles().then((profiles) => {
      if (active && profiles.length) setEngineProfiles(profiles);
    });
    return () => { active = false; };
  }, []);

  const refreshEngineProfiles = async () => {
    const profiles = await listEngineProfiles();
    if (profiles.length) setEngineProfiles(profiles);
  };

  const configureCredential = async (profile: CustomerEngineProfile) => {
    const credential = credentialDrafts[profile.id]?.trim();
    if (!credential) return;
    setCredentialBusy(profile.id);
    try {
      await configureEngineCredential(profile.id, credential);
      setCredentialDrafts((current) => ({ ...current, [profile.id]: '' }));
      await refreshEngineProfiles();
      pushToast({ kind: 'success', title: '\u5bc6\u94a5\u5df2\u5b89\u5168\u4fdd\u5b58', detail: '\u5bc6\u94a5\u7531 Windows \u52a0\u5bc6\u4fdd\u62a4\uff0c\u754c\u9762\u4e0d\u4f1a\u56de\u663e\u660e\u6587\u3002' });
    } catch (error) {
      setCredentialDrafts((current) => ({ ...current, [profile.id]: '' }));
      pushToast({ kind: 'error', title: '\u5bc6\u94a5\u672a\u4fdd\u5b58', detail: error instanceof Error ? error.message : '\u672a\u77e5\u9519\u8bef' });
    } finally {
      setCredentialBusy(null);
    }
  };

  const removeCredential = async (profile: CustomerEngineProfile) => {
    setCredentialBusy(profile.id);
    try {
      await removeEngineCredential(profile.id);
      setCredentialDrafts((current) => ({ ...current, [profile.id]: '' }));
      await refreshEngineProfiles();
    } finally {
      setCredentialBusy(null);
    }
  };

  const patch = <Key extends keyof PersonalSettings>(key: Key, value: PersonalSettings[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    updateSettings(draft);
    pushToast({ kind: 'success', title: '设置已保存', detail: '后续新任务会使用新的模型与权限偏好。' });
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[190] bg-neutral-900/30" onMouseDown={() => setOpen(false)}>
      <aside
        aria-label="我的设置"
        className="absolute bottom-0 right-0 top-0 flex w-full max-w-[520px] flex-col border-l border-neutral-200 bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><UserRound size={17} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-neutral-900">我的设置</h2>
            <p className="mt-1 text-[11.5px] text-neutral-500">管理你的分身、模型偏好和默认授权边界。</p>
          </div>
          <button type="button" aria-label="关闭我的设置" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"><X size={17} /></button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {hasEngineCredentialBridge() && <SettingsSection icon={<KeyRound size={15} />} title={'\u5f15\u64ce\u4e0e\u5bc6\u94a5'}>
            <div className="space-y-3">
              {engineProfiles.filter((profile) => profile.credentialStatus !== 'managed').map((profile) => {
                const configured = profile.credentialStatus === 'configured';
                return <div key={profile.id} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-neutral-800">{profile.label}</div>
                      <div className="mt-0.5 text-[10.5px] text-neutral-500">{configured ? '\u5df2\u914d\u7f6e' : '\u672a\u914d\u7f6e'} · {profile.dataDomain}</div>
                    </div>
                    {configured && <button type="button" disabled={credentialBusy === profile.id} onClick={() => { void removeCredential(profile); }} className="hum-btn text-danger">{'\u79fb\u9664'}</button>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      aria-label={`${profile.label}\u5bc6\u94a5`}
                      value={credentialDrafts[profile.id] ?? ''}
                      onChange={(event) => setCredentialDrafts((current) => ({ ...current, [profile.id]: event.target.value }))}
                      placeholder={configured ? '\u8f93\u5165\u65b0\u5bc6\u94a5\u4ee5\u66ff\u6362' : '\u8f93\u5165 API \u5bc6\u94a5'}
                      className="hum-input min-w-0 flex-1"
                    />
                    <button type="button" aria-label={`\u4fdd\u5b58${profile.label}\u5bc6\u94a5`} disabled={credentialBusy === profile.id || !(credentialDrafts[profile.id]?.trim())} onClick={() => { void configureCredential(profile); }} className="hum-btn is-primary">{'\u4fdd\u5b58'}</button>
                  </div>
                </div>;
              })}
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-neutral-500">{'\u5bc6\u94a5\u4ec5\u5728\u542f\u52a8\u6267\u884c\u5185\u6838\u65f6\u89e3\u5bc6\uff0c\u4e0d\u8fdb\u5165\u547d\u4ee4\u53c2\u6570\u3001\u8fd0\u884c\u65e5\u5fd7\u6216\u8bc1\u636e\u94fe\u3002'}</p>
          </SettingsSection>}
          <SettingsSection icon={<UserRound size={15} />} title="我的身份">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="姓名" value="昆仑" />
              <ReadOnlyField label="工作身份" value="企业管理员" />
            </div>
            <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-25 px-3 py-2.5 text-[11px] text-neutral-600">蓝熙集团 · 总部工作区 · 已启用企业单点登录</div>
          </SettingsSection>

          <SettingsSection icon={<Bot size={15} />} title="我的分身">
            <label className="block text-[11px] text-neutral-500">分身名称<input aria-label="分身名称" value={draft.twinName} onChange={(event) => patch('twinName', event.target.value)} className="hum-input mt-1.5" /></label>
            <div className="mt-3 space-y-2">
              <ToggleRow label="允许分身代表我接受内部工作" detail="只在你的默认权限范围内，不包含付款、外发和权限变更。" checked={draft.twinCanRepresent} onChange={(value) => patch('twinCanRepresent', value)} />
              <ToggleRow label="职场导师建议" detail="每天结合公司目标、待办和复盘，给出优先级与能力成长建议。" checked={draft.mentorEnabled} onChange={(value) => patch('mentorEnabled', value)} />
            </div>
          </SettingsSection>

          <SettingsSection icon={<BrainCircuit size={15} />} title="模型与工作空间">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-neutral-500">默认模型<select aria-label="默认模型" value={selectedProfile.label} onChange={(event) => patch('preferredModel', event.target.value as PersonalSettings['preferredModel'])} className="hum-input mt-1.5">{engineProfiles.map((profile) => <option key={profile.id} value={profile.label} disabled={!profile.available}>{profile.label}{profile.available ? '' : ' · 暂不可用'}</option>)}</select></label>
              <label className="text-[11px] text-neutral-500">默认工作空间<select aria-label="默认工作空间" value={draft.defaultWorkspace} onChange={(event) => patch('defaultWorkspace', event.target.value as PersonalSettings['defaultWorkspace'])} className="hum-input mt-1.5"><option>我的工作空间</option><option>销售共享空间</option><option>公司知识库</option></select></label>
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-neutral-500">模型档位由企业管理员配置，运行前会在计划中回显；真实供应商、模型与数据域名可在审计详情中查询。</p>
          </SettingsSection>
            <p className="mt-1 text-[10.5px] text-neutral-500">数据流向：{selectedProfile.dataDomain}</p>
            {engineProfiles.filter((profile) => !profile.available).map((profile) => <p key={profile.id} className="mt-1 text-[10.5px] leading-4 text-warning">{profile.label}暂不可用：{profile.compatibilityNote}</p>)}

          <SettingsSection icon={<ShieldCheck size={15} />} title="默认权限">
            <label className="block text-[11px] text-neutral-500">新任务默认权限<select aria-label="默认任务权限" value={draft.defaultPermission} onChange={(event) => patch('defaultPermission', event.target.value as PersonalSettings['defaultPermission'])} className="hum-input mt-1.5"><option value="L1">只查看和起草</option><option value="L2">执行前向我确认</option><option value="L3">在约定范围内自动完成</option></select></label>
            <div className="mt-3 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-neutral-25 text-center text-[10.5px] text-neutral-600"><div className="p-2"><KeyRound size={13} className="mx-auto mb-1 text-success" />内部资料</div><div className="p-2"><ShieldCheck size={13} className="mx-auto mb-1 text-warning" />外部写入需确认</div><div className="p-2"><Check size={13} className="mx-auto mb-1 text-primary-600" />全程留痕</div></div>
          </SettingsSection>

          <SettingsSection icon={<Bell size={15} />} title="提醒">
            <ToggleRow label="每日工作简报" detail="工作日 09:00 汇总目标、交办、风险和分身建议。" checked={draft.dailyBriefEnabled} onChange={(value) => patch('dailyBriefEnabled', value)} />
          </SettingsSection>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-25 px-5 py-3">
          <button type="button" onClick={() => setOpen(false)} className="hum-btn">取消</button>
          <button type="button" onClick={save} className="hum-btn is-primary" aria-label="保存我的设置"><Check size={13} /> 保存</button>
        </footer>
      </aside>
    </div>
  );
}

function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section><div className="mb-3 flex items-center gap-2 border-b border-neutral-100 pb-2 text-[12.5px] font-semibold text-neutral-900"><span className="text-primary-600">{icon}</span>{title}</div>{children}</section>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10.5px] text-neutral-400">{label}</div><div className="mt-1 rounded-md border border-neutral-200 bg-neutral-25 px-3 py-2 text-[12px] text-neutral-700">{value}</div></div>;
}

function ToggleRow({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 hover:bg-neutral-25"><input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary-600" /><span className="min-w-0"><span className="block text-[11.5px] font-medium text-neutral-800">{label}</span><span className="mt-0.5 block text-[10.5px] leading-4 text-neutral-500">{detail}</span></span></label>;
}
