# ADR-050: 能力仓 UI 只读目录与受信安装边界

- 状态：Accepted
- 日期：2026-10-07
- 范围：W5 浏览器/桌面 Renderer 能力仓

## 背景

旧技能页使用静态 `skillCatalog`，并通过 Zustand 持久状态模拟“添加到团队”和启用。这不能证明能力包真实存在，也绕过了 W5 的来源、试运行、权限、回执和安装门禁。

Relay 已提供租户限定的 `GET /v1/capabilities`。`POST /v1/capabilities/install-gate` 则只允许 `system:capability-install-gate` 身份提交由静态检查、权限复核、来源核验和导出描述组成的完整证据。普通浏览器工牌不得直接调用该系统接口。

## 决策

1. 能力页只显示显式配置的 Remote Relay 返回的目录，不保留静态样例回退。
2. Remote Relay 配置在启动时一次性消费；目录 reader 与可选 installer 只保存在模块闭包，不放入 URL、日志或 localStorage。
3. Renderer 只向独立注入的 `CapabilityInstallerBoundary` 提交不可变的 package/share 标识和摘要。证据生成、install-gate 调用和实际文件安装都属于受信本地 capability runtime，不在页面中实现。
4. 缺少 installer 时目录明确只读。401、403、网络失败和门禁拒绝都显示失败，不转换为本地“已安装”状态。
5. Renderer 只有在以下条件全部成立时显示本次安装成功：
   - 本地安装器确认已提交安装；
   - 决定为 `approved` 且由 `system:capability-install-gate` 作出；
   - 决定的 package digest、share digest、share id、target tenant 与所选目录项一致；
   - 决定的 request digest 与安装器返回的本次请求摘要一致。
6. Relay catalog 响应按共享 Capability contracts fail-closed 校验。嵌套 provenance、source boundary、permissions、trial record 或只读 share 任一畸形时，整次读取失败，不把浅层对象交给 UI。
7. 团队分享保持 `read_only`：页面无编辑、复制为租户资产或改写出处控制，只允许经过门禁安装。

## 结果

- 能力页可以展示真实状态、owner/read-only、来源、边界、试运行成败、失败说明、权限和回执。
- 页面不会把未配置、授权失败或门禁失败伪装为可用能力。
- 安装成功提示是当前会话的受信回执摘要，不是持久化安装事实；重新读取真实安装清单属于后续 capability runtime 接口范围。
- 当前没有把系统安装工牌交给浏览器，也没有直接调用 Relay 的 system-only install-gate 路由。

## 验证

- Unit：未配置 reader、批准决定摘要绑定、门禁拒绝、无持久化、Relay 深层畸形响应 fail-closed。
- UI：未配置、401、403、390px 单列只读卡片、无编辑/复制、无 installer、门禁拒绝且不显示成功。
- TypeScript：根 `typecheck`。
