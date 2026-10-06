# ADR-047: Deterministic capability export and local read-only install gate

- Status: accepted
- Date: 2026-10-07
- Scope: `packages/capability-runtime/**`, `scripts/test-capability.mjs`

## Context

ADR-045 defines the package, trial, team-share, Agent Skills descriptor, and
install-gate contracts. W5 also needs executable behavior that turns a verified
package into portable bytes and installs those bytes locally without silently
expanding permissions, changing ownership, overwriting an existing version, or
trusting renderer-supplied claims.

The Agent Skills export contains exactly eight standard files. A file cannot
embed its own final digest, and a receipt cannot embed a root hash that includes
itself. File digests and the bundle root are therefore derived from the
eight-file payload rather than introduced as a hidden ninth file or accepted as
an external caller claim. `meta.json` embeds the complete
`CapabilityPackageV1`, so the directory is self-describing across hosts without
a HUMMER sidecar.

## Decision

### Deterministic eight-file export

`createCapabilityExport` validates the package through `@hummer/contracts`,
normalizes relative source/permission paths, and emits exactly:

1. `SKILL.md`
2. `work.md`
3. `behavior.md`
4. `work_skill.md`
5. `behavior_skill.md`
6. `manifest.json`
7. `meta.json`
8. `receipt.json`

Markdown always uses LF. JSON keys are recursively sorted and files end with a
single LF. No wall clock, random identifier, absolute host path, or iteration
order from an unordered map enters the bytes. Each file receives a SHA-256; the
bundle root is SHA-256 over sorted `path + NUL + digest + LF` records.

`receipt.json` is not synthesized from package claims. The exporter requires a
source `hummer.outcome-receipt`, verifies its field hashes, root hash, non-empty
domain-event chain, event hashes, and package binding, and then copies its
canonical JSON representation. The resulting file must pass the repository's
independent `scripts/verify-receipt.mjs` verifier.

### Export rejection rules

Before returning bytes, the exporter rejects:

- draft, shadow, or retired packages;
- absolute, drive-qualified, traversal, empty, or NUL-containing boundary and
  permission paths;
- required capabilities absent from `declaredPermissions`;
- embedded video data, private-key headers, common credential forms, or an
  explicit unredacted-data marker anywhere in the eight generated files; and
- an invalid or differently bound source receipt.

The scanner is defense-in-depth. It does not replace upstream redaction or a
secret-scanning service.

### Verification regenerates expected bytes

`verifyCapabilityExport` enumerates the supplied files and requires the exact
eight-name set. It validates the package and receipt, regenerates every expected
file, recalculates each digest and the bundle root, compares the descriptor, and
reruns prohibited-content scanning. Checking only a supplied manifest or a
caller-provided `passed` boolean is insufficient.

`loadCapabilityExportDirectory(sourceDirectory)` accepts only a directory. It
enumerates and reads the exact eight regular files, parses the complete package
from `meta.json`, validates that package, then derives all file digests, the
root hash, and the descriptor from actual bytes before full regeneration. The
former API shape that supplied package/descriptor/root claims is rejected
explicitly. `installCapabilityExportDirectory` composes this loader with the
same trusted install gate for direct cross-host directory installation.

### Trusted gate input creation and verification

`createInstallGateInput` is a pure trusted-installer port. It recomputes the
descriptor and every file digest from the actual eight file strings, verifies
the receipt event chain (including provenance, package digest, five unique
successful shadow trials, and regression evidence), and returns a complete
`CapabilityInstallGateInput`. It never accepts caller-provided pass booleans.
Failures are returned as structured denials; when enough valid contract data is
available, the failed evidence statuses and denied decision are included.

`verifyInstallGateInput` independently applies the strict contracts and shared
gate assessment to a complete input. A Relay or other registry may persist and
rebind that input, but must not reconstruct missing evidence from a descriptor.

### Read-only, no-overwrite install

`installCapabilityExport` performs all validation before creating a target:

1. verify actual bundle bytes, file set, file hashes, root, and receipt;
2. validate the share through the shared contracts;
3. bind source tenant, target tenant, package bytes, package digest, and install
   request;
4. for cross-tenant installation, validate a tenant-bound invitation at the
   authenticated host boundary;
5. require at least five unique successful shadow trials and a verified passing
   regression result under the hardened contracts;
6. compare the complete approved permission tuples (capability, access, paths)
   with the package declarations; and
7. create a new version directory exclusively and write only the eight files.

There is no overwrite flag. `EEXIST` is a refusal, and the existing bytes remain
untouched. Tenant and package path segments use a restrictive allowlist that
also rejects Windows device names and trailing dots/spaces. Before writing, the
installer checks the install root and each existing path segment with
`lstat`/`realpath`, rejecting symbolic links, junctions, and reparse escapes.
It creates each directory one level at a time. The version directory remains
writable only while its eight exclusive-create writes run, then files become
0444 and the directory becomes 0555. The source bundle and package are
deep-frozen and never mutated.

Read-only means the install does not grant edit, republish, ownership-transfer,
or tenant-copy authority. Physical local bytes necessarily exist for runtime
consumption, but remain attributed to the source tenant and package digest.

## Executable gate

`npm run test:capability` emits one machine-readable JSON result. With no mode it
runs the complete local suite. Focused modes are:

- `--permissions`
- `--sharing`
- `--manifest`
- `--agentskills`

Passed checks exit 0, failed checks exit 1, and an explicit `--dry-run` reports
pending and exits 2. Each result includes test counts, negative-case counts,
toolchain details, evidence descriptions, and limitations.

## Consequences and limitations

- Equal normalized package and verified receipt input yields byte-identical
  output and digests.
- A tampered file, receipt, manifest, descriptor, digest, root, permission,
  invitation, or share binding blocks installation before target creation.
- Windows mode bits are not a security boundary. OS ACL hardening is future host
  work; no-overwrite and authorization checks are the current authoritative
  controls.
- Node does not expose an `openat`-style, directory-handle-relative create API;
  the per-segment `lstat`/`realpath` checks reduce reparse-point risk but cannot
  eliminate a privileged local actor's check-to-use race. Host ACLs remain the
  required outer boundary.
- Invitation liveness and trial/regression facts must come from authenticated
  host services and hardened contracts, never renderer-provided booleans.
- This ADR adds no public marketplace, pricing, payment, settlement, Relay,
  Desktop, migration, or UI capability.
