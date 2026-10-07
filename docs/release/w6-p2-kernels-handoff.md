# HUMMER W6 + Phase 2 本地内核交付回执

- 日期：2026-10-07
- 分支：`codex/phase0-fleet`
- 起点：`9f9cce0`（W5.1 sealed foundation）
- 本轮证据提交：`149c837`
- 状态：本地技术里程碑完成；外部/真机验收待推进

## 结果

本轮把 W6 可自动化固化项和 W7-W10 的本地领域内核接入同一集成分支。新增七类故障、容量、隐私、合成蒸馏、确定性回放、只读公开广场、合成升级回滚与脱敏诊断包门禁。

封存证据 `evidence/round-w6-p2-kernels/` 共运行 12 条命令，12 通过、0 失败、0 跳过。最终整库为 92 个单元测试文件、624 个单元用例，以及 19 个 UI 测试文件、70 个 UI 用例；类型检查与生产构建均退出 0。

## 前后 Diff

`git diff --stat 9f9cce0..149c837`：59 个文件，新增 7,284 行，删除 23 行。

提交序列：

1. `ec873c7` — W6 七类故障与本机容量门
2. `97d6685` — W9 确定性回放与晋升证据内核
3. `7d9bcd6` — W7 DemoSession 隐私内核与 migration v14
4. `1908a04` — W8 合成双轨蒸馏、纠正与回滚
5. `a17fb9c` — W6 合成升级回滚与诊断 ZIP
6. `37eadc0` — W10 只读公开广场与 migration v15
7. `8613a2c` — 本轮证据采集器
8. `149c837` — 本轮 evidence seal

Desktop migration v1-v13 未改写，只追加 v14/v15。公开广场领域包直接依赖权威 `@hummer/contracts`，没有保留手写契约镜像；Desktop 运行时不导入该工作区 TypeScript 包。

## 证据与回执

- `evidence/round-w6-p2-kernels/gates.json`：完整命令、stdout/stderr、退出码与解析后的门禁 JSON
- `evidence/round-w6-p2-kernels/report.md`：本轮证明范围与 pending 范围
- `evidence/round-w6-p2-kernels/manifest.json`：rootHash `3709c6b3de25c440e05eef670789e59f84bf842c098521c80823d95c48789923`
- 前链 W5.1 rootHash：`49b6ed7cd19aaa2262fb9159436d5c5a7d4a68d201c1cdc30f7da25160209546`

## 明确未完成

- 没有真实 OS 录制、真实专家 10 分钟示范或独立审阅。
- 没有生产 GUI grounding、真实 CUA 外部写、持久化 CapabilityGrant 消耗或多机回放。
- 没有公开 HTTP/UI、远程 bundle 传输、真实目标机落盘或 10 次第三方安装。
- 没有第二台物理 Windows 100-task、签名 NSIS 跨版本升级、5 位种子用户、20 个真实任务或付费信号。

因此本轮只能表述为“W6 与 Phase 2 本地技术内核和证据门完成”，不能表述为 Phase 2、市场化内测或真实市场验证已完成。

## 安全声明

本轮没有推送、部署、安装、真实数据删除、真实录屏、支付集成或 `F:\agent-hub` 写入。
