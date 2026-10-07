# Private Alpha preflight gate report

Status: local read-only preparation complete; external execution remains unapproved.

## Outcome

The private Alpha approval pack now has an executable stage-0 contract instead of a prose-only checklist. A candidate `preflight.json` must prove that the proposed run stays inside the approved narrow boundary before any installation, network, certificate, badge, or second-machine action is requested.

The validator is intentionally read-only. It reads one local JSON file, produces a structured `ready` or `blocked` result, and performs no network request or state-changing action.

## Enforced boundary

- explicit owner approval record and exact `fs.read.attest.v1` experiment scope;
- two distinct Windows device references and named operator references;
- credential-free, non-loopback HTTPS Relay URL and active TLS certificate digest;
- exact production Node badge scope set, at most eight hours, bound to the approved node, transferred only by offline manual entry or approved password manager;
- explicitly approved internal installer with SHA-256;
- 1-byte to 1-MiB low-sensitivity canary strictly inside a dedicated Windows workspace, with no reparse point and exactly one hard link;
- public exposure, production data, Shell, network/write/delete executors, and real payment all fixed to false;
- unknown fields, template placeholders, and credential/secret field names rejected.

The template deliberately contains `approved: false`, incomplete placeholders, zero canary bytes, and no real hashes. It must fail with exit code 2 until the owner and external resources supply real values.

## Verification

Final evidence: `evidence/round-private-alpha-preflight-rerun-1/manifest.json`.

- commit under test: `6ce9daca11d74d4bee020f1d9f573dd6c440f255`;
- root hash: `cde65bbf389e3e501a88cb9b6d3234baae3180731f8c6473cbea81e70adc4635`;
- predecessor: retained failed capture root `67c6c28202fd49de1b3520c2c8a5bdefd215c4e1eaa545aff3034ea20297b265`;
- typecheck and build passed;
- contract gate: 65 assertions, 46 negative cases;
- preflight gate: 13 positive assertions, 21 negative cases;
- incomplete template: expected exit code 2;
- security grants: 33 assertions, 47 negative cases;
- security token leak: 4 assertions, 6 negative cases;
- Relay: 22 files, 210 tests;
- root unit: 113 files, 749 tests;
- evidence seal verifier: 9 assertions and 2 tamper cases.

The first evidence attempt is intentionally retained. It failed because the capture invoked the security gate without choosing its required mode; the rerun executes both `--grants` and `--token-leak` explicitly.

## Remaining authority boundary

A `ready` record is evidence that required fields are internally consistent, not proof that the approver is authentic or that the remote machine, certificate, ACL, file, or operator was independently inspected. It does not authorize deployment. The owner must still explicitly approve the private Alpha and provide the second device, private TLS/network entry, operators, low-sensitivity canary, and badge transfer channel.
