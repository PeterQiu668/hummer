# Evidence sealing

Seal a completed round with `node scripts/evidence-seal.mjs --round <name>`. For every round after the first, pass `--prev evidence/<previous>/manifest.json` so the new manifest records the previous root hash.

The command hashes every regular file below `evidence/<round>/`, rejects symlinks and empty rounds, and creates `manifest.json` with create-only semantics. It never copies evidence bytes. If a sealed round needs correction, create a new round and link the prior manifest; do not edit or replace the old manifest.

The root hash covers the round, timestamp, Git commit, previous root hash, and sorted file metadata. Independent verification should recompute each file digest and the canonical manifest body before accepting the round.
