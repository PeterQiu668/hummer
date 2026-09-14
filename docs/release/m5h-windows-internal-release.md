# M5-H Windows internal release status

- Recorded: 2026-09-14
- Status: internal engineering build, not release-qualified
- Product version: `0.6.0-internal.1`

## Version naming

- `0.6.0-internal.N`: signed or unsigned internal validation builds only.
- `0.6.0-beta.N`: customer pilot builds after clean-Windows acceptance, dependency guidance, and release approval.
- `0.6.0`: production release after code signing, support ownership, and release evidence are complete.

## Runtime distribution

ADR-013 selects Podman Desktop plus WSL2 guidance as the normal enterprise path. Docker is detected only as a POC compatibility runtime. The setup gate gives Chinese remediation and opens the relevant official guide; it does not install or elevate silently.

The current sandbox OCI image is still a separately prepared, digest-locked artifact. Bundling it beside the NSIS installer and validating a fresh Windows host remain open release gates.

## Remaining external gates

- Certificate application: **not applied**. Owner, vendor, and target date are not provided.
- Clean Windows test: **not run**. No isolated Windows host without Node, Codex, and a container runtime is available in this environment.
- DeepSeek credential-backed tests: **blocked** until a real `DEEPSEEK_API_KEY` is placed in the repository-root `.env.local`; the key is never recorded in this file, logs, evidence, or source.
