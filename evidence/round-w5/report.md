# W5 internal beta foundation evidence report

ROUND W5 | 2026-10-06 | branch codex/phase0-fleet | source commit b3748e11683819cba82c01b6f9a8519bf5e5eadf | worktree phase0-fleet

1. 本轮目标
   - 打通远程 Relay 浏览器入口、手机批量派活、能力资产注册/分享/安装门禁、真实能力目录 UI，并形成可安装的 Windows 内测包。
2. 改动清单
   - Relay：远程 HTTPS + bearer、任务/审批/能力目录、Memory/SQLite 能力注册表。
   - Web：真实任务 POST、390px 批量派活、逐项结果、401/403 不重试；未配置时显式只读。
   - 能力：8 文件自描述 Agent Skills 导出、哈希/回执/权限/路径/覆盖保护、只读分享与受信安装决策。
   - 发布：W5 浏览器端到端门禁、Windows NSIS 内测包、内测运行手册。
3. 门禁运行记录（完整 stdout/stderr、JSON 与退出码见 `gates.json`）
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:capability` -> exit 0 (tail: status=passed, assertions=17, negativeCases=44)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:contract` -> exit 0 (tail: status=passed, assertions=50, negativeCases=33)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:web-e2e` -> exit 0 (tail: Scope: browser-client integration only; this is not external Relay or two-machine evidence.)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenancy` -> exit 0 (tail: status=passed, assertions=25, negativeCases=21)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:security` -> exit 1 (tail: status=failed, assertions=0, negativeCases=0)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:fleet -- --idempotency` -> exit 0 (tail: status=passed, assertions=10, negativeCases=4)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js test` -> exit 0 (tail: status=passed, assertions=9, negativeCases=2)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run typecheck` -> exit 0 (tail: > tsc -b --noEmit)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run build` -> exit 0 (tail: ✓ built in 14.30s)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:desktop:packaged` -> exit 0 (tail: })
4. 产物
   - `release/m5e/HUMMER-Setup-0.6.0-internal.1.exe`: 125249369 bytes, SHA-256 `714e18d4b171067bc10068fdb65e32ecfc3d58c4d22183a16716f8b6a2be1c9c`
   - `release/m5e/HUMMER-Setup-0.6.0-internal.1.exe.blockmap`: 132395 bytes, SHA-256 `dca50d14286ddbf009a4bdd182621b196f6c7c240bb51c1a2a8307a37cf53497`
   - `evidence/round-w5/gates.json`
   - `evidence/round-w5/report.md`
   - `evidence/round-w5/manifest.json`（封存后提供逐文件 SHA-256 与 rootHash）
5. 未完成 / 失败 / 降级项
   - 真实双机与外部 Relay：pending；本轮浏览器门禁使用 HTTPS route mock，不能冒充双机证据。
   - 受信安装桥：pending；UI 只接受启动时注入的 installer port，但实际部署桥尚未接线。
   - Codex 版本：主机默认 0.160.1 未做协议资格验证且被正确拒绝；打包 smoke 使用已验证的 0.153.4。
   - 代码签名：pending；安装包 Authenticode 为 NotSigned。
   - 生产 TLS/IdP、Postgres/RLS、5 名真实种子用户：均需外部环境或协调，不计为通过。
6. 契约影响
   - 已新增/加固能力包、分享、试跑、安装决策契约；Relay SQLite 迁移到 schema 15。Desktop 历史 v1-v10 未在 W5 修改。
7. 本轮触及的选型假设
   - 保持本地优先、显式审批、失败关闭；没有把浏览器 token 存入 localStorage，也没有允许 UI 直连系统安装门禁。
8. 下一轮第一件事
   - 在第二台 Windows 机器上接入真实 HTTPS Relay，完成 100 条任务双机 soak，并实现/验证目标机受信 installer bridge。
9. 阻塞与需要丘总决定的事
   - 提供第二台 Windows 机器和测试域名/IdP；确认是否为内测包购买/配置代码签名；选择 Codex 版本策略（继续精确 pin，或先对 0.160.1 做协议回归再扩大兼容范围）。

安全声明：本轮没有真实删除、安装、部署、推送或写入 agent-hub；仅生成并启动了未安装的 unpacked 内测应用。
