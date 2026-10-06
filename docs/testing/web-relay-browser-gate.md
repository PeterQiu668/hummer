# Web Relay browser-client integration gate

## Purpose

`npm run test:web-e2e` is the W5 browser-client integration gate. It runs the
real Vite React application in Playwright Chromium at a 390 x 844 viewport and
exercises the browser-facing Remote Relay client through an HTTPS route mock.

This test is deliberately narrower than a deployed-system test. The route mock
does **not** prove an external Relay, TLS termination, a production identity
provider, or two-machine delivery.

## Behaviors covered

- a deployment-time `addInitScript` injects an HTTPS Relay base URL and a
  caller-owned in-memory badge provider before the application starts;
- the one-shot configuration is consumed before React renders;
- the browser reads an online Remote Relay node;
- “开始做” sends one real browser `POST /v1/tasks/enqueue` with a TaskEnvelope;
- mobile batch dispatch requires an explicit confirmation and sends two
  TaskEnvelopes sequentially;
- a mocked 403 is presented on the matching row and is not retried;
- a separate, unconfigured browser context is read-only and sends no Relay
  request;
- the badge appears in the Authorization header, but not in localStorage,
  browser console output, or visible UI.

Screenshots are written under `dist/web-relay-e2e/`. `dist/` is ignored and
screenshots must not be committed because customer data and credentials must
never become fixtures or repository evidence.

## Run

```powershell
npm.cmd run build
npm.cmd run test:web-e2e
```

The script starts and stops its own strict-port Vite server on loopback port
4186. It uses Playwright's bundled Chromium when installed and otherwise drives
the machine's installed stable Chrome through Playwright's Chromium API; the
selected channel is printed in the receipt. A non-zero assertion, browser, or
Vite failure is returned unchanged to the caller.

## Evidence boundary

Passing this gate means the browser application, client adapter, CORS-shaped
HTTPS request boundary, UI decisions, and secret non-persistence work together
locally. It must never be reported as real Relay availability, cross-device
delivery, or production security validation.
