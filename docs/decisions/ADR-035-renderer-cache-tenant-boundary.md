# ADR-035: Renderer 内存与本地缓存必须服从认证租户边界

- 状态：Accepted
- 日期：2026-10-07
- 范围：Renderer identity、Zustand/localStorage、Workbench session/runtime cache

## 背景与风险证据

Renderer 不是授权权威，但切换企业后继续展示、操作或复用旧企业数据仍是跨租户信息泄漏。

审计确认了以下真实问题：

1. Zustand 使用固定键 `hummer-v6`，把审计记录、任务状态、授权、试岗决定和 MCP 状态写入所有租户共享的 localStorage；切换企业并刷新后会把旧企业状态重放给新企业。
2. Marketplace hires 和自定义头像使用无租户前缀的 localStorage 键。
3. Workbench 依赖 `window.location.reload()` 间接清理页面状态；直接调用身份切换 API 时，session、结果、待审批、intake 和 runtime handle 仍留在组件内存中。
4. 默认 runtime adapter 是模块级单例，内部 handle/event map 可跨 Workbench 重挂载存活。
5. MemorySessionStore 仅以 `sessionId` 建索引，没有租户分区，也不拒绝新租户继续使用旧 handle。

Desktop/API 后端仍是最终授权权威；本 ADR 不以 renderer tenant id 代替后端鉴权。

## 决策

1. 只有后端恢复、创建、邀请或切换返回的认证 identity context 才能激活 renderer tenant。
2. IdentityProvider 在 tenant 变化时先隐藏旧 UI、切换 tenant-scoped store，再以 tenant key 强制重挂载整棵应用树。切换不再依赖页面刷新。
3. Zustand 使用 `hummer.tenant.<tenant>.app-state` 分区；切换或退出时清除旧 tenant 的全部 renderer cache。历史无租户键 `hummer-v6`、`hummer-marketplace-hires`、`hummer-avatar-*` 一律删除，不迁移到任一企业。
4. Marketplace hires 和 avatar cache 使用同一认证 tenant 前缀；没有当前认证 tenant 时不读取、不写入缓存。
5. Workbench 的默认 runtime adapter 与 session store 改为组件实例，不再使用模块级 runtime 单例。tenant key 重挂载时，订阅、结果、审批、handle 和草稿一并释放。
6. MemorySessionStore 按当前 tenant 分区，并记录每个 runtime handle 的 tenant owner；切换 tenant 后列举为空，旧 handle 的 append/save 操作失败关闭。
7. DesktopSessionStore 绑定创建时 tenant，每次调用仍读取当前认证会话；tenant 变化后旧 store 实例失败关闭，后端继续做权威鉴权。

## 验证

稳定行为标记 `[TEN-P0E-RENDERER-CACHE]` 覆盖：

- 两个认证 tenant 之间切换会重挂载组件，旧草稿和 Zustand 内存不可见；
- legacy/global cache 被删除，当前 tenant cache 在切换后也被清除；
- 新 tenant 不会看到旧 tenant 的审计结果、任务预填或 marketplace hires；
- MemorySessionStore 双租户列表隔离，旧 runtime handle 无法在新 tenant 追加事件；
- 清除身份会话同步清除当前 tenant renderer cache。

## 影响

切换或退出企业会主动丢弃旧企业的 renderer 缓存；重新进入时真实业务事实从后端权威存储读取。仅原型态、没有后端事实源的 UI 状态可能重置，这是阻止跨租户复用的有意安全取舍。
