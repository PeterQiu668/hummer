# ADR-058: Trusted capability bundle Relay-to-Node bridge

- Status: accepted
- Date: 2026-10-07
- Scope: `packages/contracts/src/trusted-bundle/**`, `apps/relay/src/trusted-bundle-relay.ts`, `apps/node-agent/src/trusted-bundle-installer.mjs`

## Context

ADR-047 proves a deterministic eight-file Agent Skills export and a safe local
install gate, while ADR-048 stores capability metadata and install decisions in
Relay. Neither ADR transports the reviewed bytes to a target node. Treating a
catalog record or approved decision as proof of remote installation would leave
an untrusted gap between the reviewed bytes and the materialized files.

This bridge closes that local technical gap without claiming an external
installation. It must not accept a caller-authored approval, install into a real
runtime directory, overwrite an existing version, or persist credentials, raw
recordings, or unredacted customer material.

## Decision

### Strict immutable transport envelope

`TrustedBundleEnvelopeV1` carries exactly eight canonical-base64 files and an
eight-entry descriptor. It binds tenant, target node, team share, install gate,
request/share/package digests, package version, bundle root, and the complete
approved install decision. TypeBox is the structural source, Ajv rejects unknown
fields, and semantic validation rejects duplicate/missing paths, non-canonical
base64, size violations, per-file digest errors, root errors, prohibited content,
invalid capability metadata, and share/package/decision mismatches.

The Relay publication boundary also loads the trusted persisted gate input and
decision. It recomputes the decision and requires the transported file digests
to equal the `AgentSkillsExportDescriptor` that was evaluated. The in-memory
reference store is immutable and idempotent: replaying identical bytes returns
the original result; reusing a bundle id with different bytes is rejected.
Tenant and node badges are authoritative, and a target node can read only its own
tenant/node-bound bundle.

### Node re-verification and explicit human approval

The node does not trust Relay transport validation as installation proof. It
revalidates the envelope, reconstructs `CapabilityExportBundle`, and invokes the
existing `verifyCapabilityExport`. That verifier regenerates all eight expected
files and checks manifest, receipt event chain, package digest, trial evidence,
and prohibited content. A separate `TrustedBundleHumanApprovalV1` must match the
tenant, target node, bundle, gate, and bundle root.

### Synthetic-only atomic materialization

This kernel writes only below a directory initialized with the exact
`.hummer-synthetic-install-root.json` marker. It uses safe single path segments,
refuses symlink/reparse roots and existing targets, writes the eight files into a
fresh sibling staging directory, makes them read-only, then performs one atomic
directory rename. A failed rename restores staging permissions and removes only
the known eight staging files. No overwrite switch exists.

## Consequences and limits

- Manifest changes, receipt rebinding, digest tampering, unknown fields,
  credentials, raw video data, and unredacted markers fail closed.
- Interrupted downloads do not call the installer. Duplicate delivery cannot
  overwrite a target. Rename failure leaves neither a target nor staging files.
- The reference Relay store is in-memory. A production adapter must persist the
  same immutable tuple and the complete trusted gate input.
- This ADR proves a loopback local Relay-to-Node kernel and synthetic install
  root. It does not prove a second machine, production deployment, external
  connectivity, a real runtime install, or user adoption.

## Rejected alternatives

- **Transport metadata only.** A target cannot verify bytes it never receives.
- **Trust an embedded approved decision.** A caller could forge the decision;
  Relay must derive it from trusted persisted gate evidence.
- **Check only `meta.json`.** This misses manifest and receipt substitution;
  the existing full export verifier is mandatory at the node.
- **Write directly into the final directory.** Interruption can create a partial
  install; staging plus atomic rename is required.
- **Install into a discovered user/runtime skill directory.** That is outside the
  authorized local kernel and requires a separate product decision and real-host
  acceptance evidence.
