# ADR-013: M5-H container runtime and image distribution

- Status: accepted for internal delivery, not yet clean-Windows accepted
- Date: 2026-09-14

## Context

`workspace.exec` is only available after the HUMMER-owned container isolation self-check passes all five probes: inside write succeeds; path escape, network egress, DNS resolution, and raw-socket access each fail. Docker Desktop was sufficient for the M5-G development evidence, but it is not the default enterprise distribution dependency.

## Decision

HUMMER selects **Option A**: the NSIS installer and startup gate detect the local runtime and guide the operator to install Podman Desktop and enable WSL2. HUMMER does not silently install a runtime, alter Windows features, or request elevation during normal application startup.

- Podman is the production recommendation. The setup gate opens the official Windows installation guide and gives a Chinese, actionable status when the runtime is absent.
- Docker remains a detected **POC compatibility mode**, not the recommended enterprise dependency. A passing Docker self-check is still sufficient to enable `workspace.exec` on the current machine.
- Option B (customer-provided runtime) remains a POC fallback only. It is not the normal deployment story.
- Option C (a new WSL2-native isolation implementation) is rejected for M5-H. It would create a second sandbox lifecycle that still needs the same five-probe proof and would duplicate the tested container control plane.

## Image distribution

The production/offline direction is an installer-adjacent, versioned OCI archive with a locked digest. First-start registry pull is an opt-in online fallback only; its digest must match the release manifest before import. The existing image evidence remains `hummer-office-sandbox:m5g` digest `sha256:c8a7ef25c51fea55776ceb5d5e982bd0420d60a142877f0ceae3e3b43fa73b2d` and compressed content size 118,791,022 bytes.

| Method | Offline use | Size impact | Compliance and operational effect |
| --- | --- | --- | --- |
| Installer-adjacent OCI archive | Yes | Adds about 119 MB before installer compression | Supports air-gapped deployment; release must publish and verify an image digest. |
| First-start pull | No | Small installer | Requires registry allowlist and network; never silently substituted for an offline artifact. |
| Manual offline import | Yes | No installer growth | Suitable for IT-managed POC; adds a documented operator step. |

The image remains reproducible from `spikes/m5g-sandbox/container/Dockerfile` and its locked requirements file. The OCI archive is not yet bundled into the NSIS artifact; no customer-ready packaging claim follows from this ADR.

## Evidence and constraints

- Local assessment at 2026-09-14: Podman was not installed; WSL2 was present but reported an outdated kernel; Docker Engine 28.3.2 was available.
- The `RuntimeSetupGate` now distinguishes a missing container runtime from a failed network-isolation check and exposes the Podman setup action in Chinese.
- A clean Windows host with no Node, Codex, or container runtime is still unavailable in this development environment. The required installation evidence is therefore **blocked**, not simulated.
- Podman on Windows runs through a WSL2-backed machine and requires its own initialization/start lifecycle. Microsoft documents that WSL installation can require administrative access and a restart. These are explicit customer IT prerequisites, not actions HUMMER performs silently.

## Consequences

`workspace.exec` remains fail-closed. Any missing runtime, incomplete self-check, or failed network/DNS/raw-socket probe disables execution. Codex remains read-only and has no shell access; the container boundary belongs to HUMMER rather than to Codex.

## Sandbox archive and cleanup policy

Each order receives a distinct directory under the configured execution root. HUMMER keeps completed order workspaces as local, content-addressed evidence until an explicitly authorized retention policy exists. M5-H deliberately does **not** add automatic deletion: silently deleting a customer artifact would be destructive and would weaken receipt replay. The current runtime removes only its disposable container volume after each invocation; it never reuses an order directory. A later retention feature must first expose per-order size, archive state, restore location, and an operator-confirmed cleanup action with an audit event.

Sources checked on 2026-09-14: Podman Windows installation and machine documentation, Microsoft WSL installation guidance, and Podman `save`/`load` documentation.
