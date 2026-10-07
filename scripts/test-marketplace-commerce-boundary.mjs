import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const forbiddenDependencies = [
  'stripe', 'paypal', 'braintree', 'adyen', 'square', 'razorpay', 'alipay', 'wechatpay',
];
const forbiddenProductionTokens = [
  'paymentToken', 'cardNumber', 'bankAccount', 'webhookSecret', 'createPaymentIntent',
  'checkout.session', 'stripe', 'paypal', 'braintree', 'adyen', 'razorpay', 'alipay', 'wechatpay',
];
const productionFiles = [
  'apps/desktop/src/persistence/migrations.ts',
  'apps/relay/src/fastify-transport.ts',
  'packages/public-market/src/index.ts',
];

const manifests = [
  resolve(repository, 'package.json'),
  ...['apps', 'packages'].flatMap((directory) =>
    readdirSync(resolve(repository, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(repository, directory, entry.name, 'package.json')),
  ),
];
const dependencyViolations = [];
for (const manifestPath of manifests) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (forbiddenDependencies.some((name) => dependency.toLowerCase().includes(name))) {
        dependencyViolations.push(`${relative(repository, manifestPath)}:${section}:${dependency}`);
      }
    }
  }
}

const tokenViolations = [];
const sources = new Map();
for (const file of productionFiles) {
  const source = readFileSync(resolve(repository, file), 'utf8');
  sources.set(file, source);
  for (const token of forbiddenProductionTokens) {
    if (source.toLowerCase().includes(token.toLowerCase())) tokenViolations.push(`${file}:${token}`);
  }
}

const migration = sources.get('apps/desktop/src/persistence/migrations.ts');
const publicMarket = sources.get('packages/public-market/src/index.ts');
const assertions = [
  {
    name: 'no payment-provider dependency is declared',
    passed: dependencyViolations.length === 0,
    detail: dependencyViolations,
  },
  {
    name: 'commerce production files contain no payment credential or provider API token',
    passed: tokenViolations.length === 0,
    detail: tokenViolations,
  },
  {
    name: 'schema v17 names the boundary as dry-run marketplace commerce',
    passed: migration.includes("name: 'p3_dry_run_marketplace_commerce'") && migration.includes("CHECK (mode = 'dry_run')"),
    detail: [],
  },
  {
    name: 'offers are integer CNY amounts and settlements expose exact reconciliation',
    passed: migration.includes("CHECK (currency = 'CNY')")
      && migration.includes('CHECK (price_cents > 0)')
      && publicMarket.includes('reconcileDryRunSettlement'),
    detail: [],
  },
];
const failed = assertions.filter((assertion) => !assertion.passed);
const result = {
  schema: 'hummer.executable-gate-result',
  version: 1,
  gate: 'marketplace-commerce-boundary',
  mode: 'local-static-no-real-payment',
  status: failed.length === 0 ? 'passed' : 'failed',
  assertions,
  assertionCount: assertions.length,
  negativeCases: forbiddenDependencies.length + forbiddenProductionTokens.length,
  limitations: [
    'This gate proves only repository-level absence of known provider SDKs and credential fields in the scoped implementation.',
    'It does not authorize real payment, custody, payout, tax, invoice, refund, chargeback, or marketplace launch.',
  ],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
