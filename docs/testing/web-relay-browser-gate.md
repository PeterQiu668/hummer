# Web Relay browser-client integration gate

## Purpose

`npm run test:web-e2e` is the browser-to-Relay integration gate. It runs the
real Vite React application in Playwright Chromium at a 390 x 844 viewport and
exercises the production browser client against a real loopback Fastify Relay
created through `createFleetRelayServer`, `FleetService`, and
`MemoryFleetStore`.

This test is deliberately narrower than a deployed-system test. The loopback
server does **not** prove an external Relay, TLS termination, a production
identity provider, or two-machine delivery.

## Behaviors covered

- a production Node `RelayHttpClient` registers one synthetic node through the
  real HTTP boundary before the browser starts;
- a deployment-time `addInitScript` injects a loopback Relay base URL and a
  caller-owned in-memory badge provider before the application starts;
- the one-shot configuration is consumed before React renders;
- the browser reads an online Remote Relay node;
- “开始做” sends one real browser `POST /v1/tasks/enqueue` with a TaskEnvelope;
- mobile batch dispatch requires an explicit confirmation and sends two
  TaskEnvelopes sequentially into the real Relay store;
- the production Node client claims one browser-enqueued TaskEnvelope from the
  same Relay state;
- real 401 and 403 responses are presented, terminal, and not retried;
- a separate, unconfigured browser context is read-only and sends no Relay
  request;
- the badge appears in the Authorization header, but not in localStorage,
  browser console output, or visible UI.

Synthetic screenshots are written under a unique
`evidence/round-p1-real-web-relay-e2e-<attempt>/screenshots/` directory. The
machine-readable `gate.json` records each screenshot's SHA-256 and byte length.
An existing round is always rejected rather than overwritten; failed attempts
retain `failure.json` and any screenshots captured before failure. Badge values
are never written into these artifacts.

## Run

```powershell
npm.cmd run build
npm.cmd run test:web-e2e
# Optional explicit immutable attempt name:
npm.cmd run test:web-e2e -- --round=round-p1-real-web-relay-e2e-review-01
```

The script starts and stops both its own strict-port Vite server on loopback
port 4186 and a real Fastify Relay on an ephemeral `127.0.0.1` port. It uses
Playwright's bundled Chromium when installed and otherwise drives the machine's
installed stable Chrome through Playwright's Chromium API; the selected channel
is recorded in the receipt. A non-zero assertion, browser, Relay, or Vite
failure is returned unchanged to the caller.

## Evidence boundary

Passing this gate means the browser application, production browser and Node
clients, real Fastify route/authentication/contract/store boundary, UI
decisions, and secret non-persistence work together locally. It must never be
reported as external Relay availability, cross-device delivery, TLS/IdP proof,
or production security validation.
