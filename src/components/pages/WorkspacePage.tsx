/**
 * WorkspacePage — 所有内容型页面统一外壳
 * Header (title + sub + actions) + Body (scrollable)
 */
import { ReactNode } from 'react';

export default function WorkspacePage({
  title, sub, actions, children, sticky,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
  sticky?: ReactNode;
}) {
  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-neutral-50">
      {/* Page header */}
      <div className="shrink-0 bg-white" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="px-6 py-4 flex items-end gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="hum-h1 truncate">{title}</h1>
            {sub && <p className="text-[12.5px] hum-muted mt-1 truncate">{sub}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {sticky && <div className="px-6 pb-3">{sticky}</div>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// Empty-state component used across pages.
export function EmptyState({
  title, sub, action, icon,
}: { title: string; sub?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="hum-card-soft flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && <div className="w-12 h-12 rounded-full bg-neutral-100 grid place-items-center text-neutral-500 mb-3">{icon}</div>}
      <div className="text-[14px] font-semibold text-neutral-900">{title}</div>
      {sub && <div className="text-[12.5px] hum-muted mt-1 max-w-md">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
