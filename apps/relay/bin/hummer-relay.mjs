#!/usr/bin/env node

try {
  const { runRelayCli } = await import('../dist/apps/relay/src/cli.js');
  await runRelayCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown relay startup failure';
  process.stderr.write(`${JSON.stringify({
    schema: 'hummer.relay-error',
    version: 1,
    error: message,
  })}\n`);
  process.exitCode = 1;
}
