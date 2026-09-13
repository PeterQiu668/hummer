# M5-G Windows internal release status

- Recorded: 2026-09-13
- Status: not release-qualified
- Product version: `0.5.0-internal.1`

## Code signing

- Certificate application: **not applied**
- Responsible owner: **unassigned**
- Certificate vendor: **unselected**
- Expected completion date: **unassigned**
- Blocker: a legal entity owner and procurement decision have not been provided. No date or vendor is invented in this record.

## Clean Windows acceptance

No clean Windows host without Node, Codex, and a container runtime was available in this development environment. The required install -> dependency guidance -> credential configuration -> real office order workflow was not run and is not claimed.

M5-G adds another mandatory dependency gate: the versioned office OCI image must be available locally and the five network-isolation probes must pass at every startup. Current evidence uses an already-installed Docker Desktop engine. Podman-first setup, bundled-image import, Chinese remediation guidance, and ordinary-user installation still require a clean-machine acceptance run.

## Packaging decision

ADR-012 selects an installer-adjacent, versioned OCI image archive over first-start internet download for enterprise/offline delivery. That archive is not yet bundled into the NSIS artifact. No M5-G installer has been produced, signed, or presented as customer-ready.
