# Trusted bundle SQLite persistence

The Relay trusted-bundle server accepts any implementation of
`TrustedBundleRelayStore`. Its default remains the in-memory implementation for
small local tests. A durable local Relay must construct and inject
`SqliteTrustedBundleRelayStore` explicitly:

```ts
const bundleStore = new SqliteTrustedBundleRelayStore(databasePath);
const { app } = createTrustedBundleRelayServer({
  authenticator,
  approvedDecisionLookup,
  store: bundleStore,
});
```

Close both the Fastify app and the store during shutdown:

```ts
await app.close();
bundleStore.close();
```

## Guarantees

- Publication still performs the ADR-058 contract, byte, decision, tenant, and
  descriptor checks before persistence.
- `(tenantId, bundleId)` is immutable. Replaying identical validated bytes is
  idempotent; different bytes under the same id return `bundle_conflict`.
- A node can fetch only a bundle in its authenticated tenant and bound target
  node.
- SQLite lock or write failure returns a Relay error. No success is emitted
  until the one-row transaction commits.
- Reopening the database reconstructs the exact validated envelope and validates
  its stored metadata plus complete gate input and derived decision before
  returning it.

## Verification

Run the machine-readable local gate with the repository's pinned Node runtime:

```powershell
& 'E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe' `
  'scripts\test-trusted-bundle-bridge.mjs'
```

The final line is a `hummer.executable-gate-result` JSON object. It covers the
existing Relay-to-Node protocol and the durable restart, idempotency, conflict,
tenant/node isolation, lock, and injected write-failure cases.

## Operational limits

This adapter is a local SQLite persistence option. It is not evidence of an HA
Relay, encrypted storage, external backup/restore, Postgres/RLS, production
deployment, a remote host install, or a real user skill-directory write.
