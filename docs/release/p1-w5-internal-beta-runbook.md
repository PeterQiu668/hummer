# P1 W5 internal beta runbook

Status: technical internal-beta preparation. This runbook does not declare the
external acceptance gates complete.

## Supported scope

The W5 browser beta supports an explicitly provisioned HTTPS Remote Relay and
an in-memory badge provider. It exposes read-only node discovery, reviewed
single-task dispatch, and explicitly confirmed 2–20 item mobile batch dispatch.
The browser does not discover Relay configuration from URL parameters or
localStorage.

## Install and verify

1. Check out the approved W5 release commit on the test machine.
2. Use the repository-pinned Node/npm environment and install from the reviewed
   lockfile. Do not paste badges into shell history or `.env` files.
3. Run `npm.cmd run build`.
4. Run `npm.cmd run test:web-e2e` and retain its exit code and textual receipt.
5. Run the normal release test suite required by the integration owner.
6. Serve `dist/` only behind the approved HTTPS origin. Do not expose the Vite
   development server as the beta service.

## Deployment-time browser configuration

The hosting/bootstrap boundary must set `window.hummerRemoteRelayDeployment`
before the application module executes:

```js
window.hummerRemoteRelayDeployment = {
  baseUrl: 'https://relay.internal.example',
  getBadge: () => obtainBadgeFromTheApprovedInMemorySession(),
};
```

Requirements:

- `baseUrl` is HTTPS except for loopback-only development.
- `getBadge` returns a short-lived, tenant-scoped badge from the approved
  authenticated session boundary.
- badges are never stored in localStorage, URLs, logs, screenshots, source,
  checked-in configuration, or support bundles.
- the Relay CORS policy allows only the exact approved web origin and the
  `Authorization` and `Content-Type` headers.

Production identity-provider provisioning and production TLS validation remain
outside this W5 local gate.

## Operator acceptance checks

1. Open the browser at 390px width and confirm an online Relay node is listed.
2. Open “开始做”, generate a plan, inspect it, and confirm once. Verify exactly
   one pending TaskEnvelope appears at the Relay.
3. Fill two batch rows. Verify the send control remains disabled until the
   explicit confirmation checkbox is selected.
4. Submit once and compare each row result with the corresponding Relay result.
5. Use an expired or under-scoped test badge. Verify 401/403 is visible and the
   request is not retried.
6. Open a fresh page without deployment configuration. Verify both single and
   batch dispatch remain read-only.
7. Inspect browser storage, console, screenshots, and support output for the
   test badge. Any appearance is a release blocker.

## Rollback

Rollback is configuration-first and reversible:

1. Remove the deployment-time `hummerRemoteRelayDeployment` injection from the
   approved web bootstrap.
2. Revoke the beta badge(s) at the identity/badge issuer.
3. Reload open sessions. The browser falls back to explicit read-only behavior;
   it must not switch to mock success.
4. If the release artifact itself is faulty, restore the previously approved
   static `dist/` artifact and repeat its recorded smoke gate.
5. Preserve audit and test receipts. Do not delete task, message, evidence, or
   session data as part of rollback.

## Known limits and unfinished gates

- `test:web-e2e` uses a real Fastify Relay with an in-memory store on loopback.
  It is local browser/Node integration evidence, not proof of a reachable
  external Relay, TLS termination, production identity, or two-machine delivery.
- Real two-machine 100-task soak evidence is not complete.
- External five-person seed-user acceptance is not complete.
- The 15-minute independent install, 20 real tasks at 70% success, and three
  real capability installs are not complete.
- Production IdP, certificate/TLS, badge issuance/revocation operations, and
  hosted monitoring are not complete.
- Payment, billing, public marketplace, and public launch are not part of W5
  and have not been enabled.
- Any deployment, production data mutation, payment, deletion, or public launch
  is an L3 action and requires explicit human approval.
