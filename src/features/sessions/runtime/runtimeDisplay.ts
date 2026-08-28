export interface RuntimeAuditIdentity { runtimeId: string; providerName: string; modelName: string; dataDomain: string; sandbox: string; }

const runtimeNames: Record<string, string> = { 'codex-cli': 'HUMMER 执行内核', 'claude-code': 'HUMMER 执行内核', 'mock-runtime-v4': '演示执行内核' };
const actorNames: Record<string, string> = { 'employee:codex': 'HUMMER 数字员工', 'employee:claude': 'HUMMER 数字员工', 'system:desktop-host': '本地执行节点', 'human:operator': '你' };

export function runtimeDisplayName(runtimeId: string, actorRef?: string): string {
  if (actorRef && actorNames[actorRef]) return runtimeNames[runtimeId] ?? actorNames[actorRef];
  return runtimeNames[runtimeId] ?? 'HUMMER 执行内核';
}
export function actorDisplayName(actorRef: string): string { return actorNames[actorRef] ?? actorRef.replace(/^[^:]+:/, ''); }
export function runtimeAuditIdentity(identity: RuntimeAuditIdentity): RuntimeAuditIdentity { return { ...identity }; }
