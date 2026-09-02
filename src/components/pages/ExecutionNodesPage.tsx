import { useEffect, useState } from 'react';
import { CircleStop, FolderOpen, Monitor, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import { desktopExecutionNodePort, type ExecutionNodeRecord } from '../../features/execution-nodes/executionNodeClient';
import { runtimeDisplayName } from '../../features/sessions/runtime/runtimeDisplay';
import WorkspacePage from './WorkspacePage';

export default function ExecutionNodesPage() {
  const [nodes, setNodes] = useState<ExecutionNodeRecord[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const port = desktopExecutionNodePort();
    if (!port) {
      setNodes([]);
      setMessage('当前浏览器原型未连接桌面宿主，无法确认节点状态。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setNodes(await port.list());
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取执行节点状态');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const killAll = async () => {
    const port = desktopExecutionNodePort();
    if (!port) return;
    try {
      const result = await port.killAll();
      setMessage(result.killed > 0 ? `已向 ${result.killed} 个运行中的执行进程发送停止信号。` : '当前没有运行中的执行进程。');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停止执行进程失败');
    }
  };

  return <WorkspacePage title="执行节点" sub="查看本地执行环境、当前会话和权限边界；紧急情况下可停止所有运行中的进程。" actions={<><button type="button" onClick={() => { void refresh(); }} className="hum-btn is-sm"><RefreshCw size={12} /> 刷新</button><button type="button" onClick={() => { void killAll(); }} disabled={!nodes.some((node) => node.status === 'online')} className="hum-btn is-sm is-danger disabled:opacity-40"><CircleStop size={12} /> 全部停止</button></>}>
    <div className="mx-auto max-w-[1280px] space-y-4 p-5">
      {message && <div role="status" className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-[11.5px] text-neutral-600">{message}</div>}
      {loading && <div className="py-16 text-center text-[12px] text-neutral-400">正在读取节点事实...</div>}
      {!loading && nodes.length === 0 && <div className="rounded-md border border-dashed border-neutral-300 bg-white px-5 py-16 text-center"><Monitor size={22} className="mx-auto text-neutral-300" /><div className="mt-3 text-[13px] font-medium text-neutral-700">没有已验证的执行节点</div><div className="mt-1 text-[11px] text-neutral-500">启动 HUMMER 桌面版后，主进程会登记真实节点状态。</div></div>}
      {nodes.map((node) => <section key={node.id} data-node-id={node.id} className="hum-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-neutral-900 text-white"><Monitor size={16} /></span><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-neutral-900">{node.displayName}</div><div className="mt-0.5 font-mono text-[9.5px] text-neutral-400">{node.id}</div></div><span className={`hum-chip ${node.status === 'online' ? 'is-success' : 'is-error'}`}><span className="hum-dot" />{node.status === 'online' ? '在线' : '离线'}</span></div>
        <div className="grid divide-y divide-neutral-200 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          <NodeFact icon={<Workflow size={13} />} label="执行内核" value={runtimeDisplayName(node.runtimeId)} detail={node.currentSessionId ? `当前会话 ${node.currentSessionId}` : '当前无运行会话'} />
          <NodeFact icon={<FolderOpen size={13} />} label="工作目录" value={node.cwd} detail="只在本节点授权范围内读写" />
          <NodeFact icon={<ShieldCheck size={13} />} label="权限范围" value={node.permissionScope} detail="高危动作继续受审批策略约束" />
          <NodeFact icon={<RefreshCw size={13} />} label="最近心跳" value={new Date(node.lastSeenAt).toLocaleString('zh-CN', { hour12: false })} detail="状态来自 Electron 主进程" />
        </div>
      </section>)}
    </div>
  </WorkspacePage>;
}

function NodeFact({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="min-w-0 p-4"><div className="flex items-center gap-1.5 text-[10.5px] text-neutral-500">{icon}{label}</div><div className="mt-2 break-all text-[12px] font-medium text-neutral-800">{value}</div><div className="mt-1 text-[10px] leading-4 text-neutral-400">{detail}</div></div>;
}
