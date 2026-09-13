# ADR-012: HUMMER-owned office execution sandbox

- Status: Accepted for internal validation; release gates open
- Date: 2026-09-13
- Milestone: M5-G

## Context

M5-F correctly rejected `workspace.exec`. Codex CLI 0.153.4 could write inside a dedicated Windows directory and Windows permissions blocked `../..` traversal, but an HTTPS request still succeeded. Codex's developer sandbox is not the enterprise isolation boundary HUMMER promises.

M5-G keeps Codex read-only and disables its built-in shell. `workspace.exec` is instead a HUMMER-owned MCP capability: Codex proposes one structured call, the Electron main process authorizes a session-bound lease, and a separate container performs the work.

## Probe decisions

### P0.1 Windows account plus SID firewall: NO-GO

The run at `2026-09-13T21:01:24+08:00` used account `h4-480\codexsandboxoffline` and its SID-bound outbound rules. Evidence is `spikes/m5g-sandbox/p0-1-firewall-evidence.json`.

- in-sandbox write: pass, with SHA-256
- path escape: blocked
- HTTPS egress: **not blocked**
- DNS resolution: **not blocked**
- raw socket: blocked

Result: 3/5. This path is rejected and is not used as the production control.

### P0.2 container boundary: technical GO on this workstation

Podman was evaluated first but is not installed. Installing a second material runtime was not performed implicitly. Podman's Windows installation also requires a WSL2-backed machine. The already-installed Docker Desktop 4.44.1 / engine 28.3.2 was used for the feasibility run. Evidence is `spikes/m5g-sandbox/p0-2-container-evidence.json`.

The image uses a read-only root filesystem, non-root UID 65532, `--network=none`, all Linux capabilities dropped, no-new-privileges, PID/memory/CPU limits, and one unique writable named volume. All five probes passed: inside write succeeded; path escape, HTTPS, DNS, and raw socket failed.

Direct Windows bind mounts were intermittently unusable across Chinese and ASCII paths. The product implementation therefore does not expose a host directory to the execution container. It stages a validated snapshot into a per-execution named volume over stdin, runs the non-root container, exports the volume snapshot over stdout, revalidates paths/symlinks/size, hashes every artifact, writes the order archive, and destroys the volume.

Podman remains the preferred production runtime because it is Apache-2.0 and daemonless, but its Windows behavior is not yet proven here. Docker Desktop is an accepted development fallback only. Docker's published terms require paid use in larger enterprises (more than 250 employees or more than USD 10 million annual revenue), so it cannot silently become HUMMER's enterprise dependency.

References:

- Podman Windows installation: https://podman.io/docs/installation
- Podman `--network=none` and `--read-only`: https://docs.podman.io/en/latest/markdown/podman-run.1.html
- Docker Desktop subscription terms: https://docs.docker.com/subscription/desktop-license/

## Decision

1. Codex remains `read-only`; `features.shell_tool=false` is passed to every execution and fork. HUMMER also discovers configured user MCP servers and disables each one before enabling only `hummer_local`. Wire evidence for all six workflows shows no `commandExecution` and no inherited MCP startup.
2. `workspace.exec` is capability four. It is a `builtin` transport exposed through `hummer_local/workspace_exec`; product-domain types do not import Codex, Electron, Docker, Podman, or SQLite types.
3. Each runtime process receives a random 256-bit broker lease bound to its authenticated session and `workOrderId`. The secret travels only in the child environment, never argv, wire logs, trajectories, evidence, or screenshots. Invalid and revoked leases fail before execution.
4. Additive migration v9 stores startup isolation checks and execution jobs. Migrations v1-v8 are unchanged. Startup performs the real five-probe self-check once; a 5/5 result enables the capability and is appended to the hash chain. Any failure disables every call and shows `执行能力不可用：本机网络隔离未生效` with diagnostics.
5. The office image pins `python-pptx`, `python-docx`, `openpyxl`, `matplotlib`, Pillow, Jinja2, and WenQuanYi Zen Hei for Chinese rendering. The final validated image is `hummer-office-sandbox:m5g`, digest `sha256:c8a7ef25c51fea55776ceb5d5e982bd0420d60a142877f0ceae3e3b43fa73b2d`, compressed content size 118,791,022 bytes. All artifacts are re-opened by the main process, constrained to the order directory, SHA-256 addressed, added to `tool_invocations`, and chained into receipts.
6. For enterprise and offline delivery, the selected packaging direction is a versioned OCI image archive shipped alongside the installer and imported during setup, rather than a first-start internet pull. This avoids supply-chain drift and supports air-gapped customers, at the cost of a materially larger installer. That packaging step and clean-machine import are release gates and are not claimed complete in M5-G.
7. `external.send*`, `crm.write*`, payment, permission, deletion, host export, and network access remain outside the free sandbox and require existing protocol/control-plane approval. M5-G does not implement a channel or CRM connector.

## Evidence

- Product container service: `spikes/m5g-sandbox/product-service-evidence.json`
- Real Codex-to-MCP execution: `spikes/m5g-workspace-exec/workspace-exec-evidence.json`
- Real execution UI: `spikes/m5g-workspace-exec/workspace-exec-ui.png`
- Six independent order workflows: `spikes/m5g-workflows/{website,deck,report,image,sales,content}/*-evidence.json`
- Website browser render: `spikes/m5g-workflows/website/website-browser.png`
- Durable UI screenshots: `spikes/m5g-workflows/{image,content}/*-ui.png`
- Curated deliverables: `spikes/m5g-workflows/<kind>/artifacts/`

These combine two proof classes and keep them explicit: Codex/MCP wire logs prove real external runtime tool calls; approval decisions, event-chain integrity, artifact hashing, and receipt verification prove the local HUMMER product chain. Approved outflow branches do not prove delivery because channels are intentionally absent.

## Consequences and open gates

- HUMMER can now accept, confirm, plan, and execute isolated office orders without giving Codex host shell or host write access.
- Podman has not been installed or run on this Windows machine. Docker proved the boundary but is not the final enterprise distribution choice.
- `.env.local` is absent, so the three DeepSeek E2Es remain blocked; internal Codex-login evidence is not substituted.
- No clean Windows machine was available. OCI image packaging, dependency bootstrap, unsigned-installer onboarding, and code signing remain release blockers.
- WenQuanYi Zen Hei is included in the validation image under GPL-2.0 with the font embedding exception and M+ Fonts License. Its source and distribution obligations are recorded in `THIRD_PARTY_NOTICES.md`; the complete license text must accompany any shipped OCI archive.
