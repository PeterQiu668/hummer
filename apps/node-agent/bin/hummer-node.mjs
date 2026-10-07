#!/usr/bin/env node
import { createNodeAgentDaemonFromFile } from '../src/daemon.mjs';
import { probeAllRuntimes } from '../src/runtime-probes.mjs';

const [command, ...args] = process.argv.slice(2);

if (!['probe', 'run'].includes(command)) {
  process.stderr.write('Usage: hummer-node probe [--other-executable <name-or-path>] | run --config <absolute-json>\n');
  process.exitCode = 2;
} else if (command === 'probe') {
  const optionIndex = args.indexOf('--other-executable');
  if (optionIndex >= 0 && (!args[optionIndex + 1] || args.length !== 2)) {
    process.stderr.write('--other-executable requires exactly one value\n');
    process.exitCode = 2;
  } else if (optionIndex < 0 && args.length > 0) {
    process.stderr.write(`Unknown arguments: ${args.join(' ')}\n`);
    process.exitCode = 2;
  } else {
    const cliOtherExecutable = optionIndex >= 0 ? args[optionIndex + 1] : undefined;
    const results = await probeAllRuntimes(cliOtherExecutable ? { cliOtherExecutable } : {});
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), runtimes: results }, null, 2)}\n`);
    if (results.every((item) => item.status !== 'available')) process.exitCode = 1;
  }
} else {
  const configIndex = args.indexOf('--config');
  if (configIndex < 0 || !args[configIndex + 1] || args.length !== 2) {
    process.stderr.write('Usage: hummer-node run --config <absolute-json>\n');
    process.exitCode = 2;
  } else {
    /** @param {Readonly<Record<string, unknown>>} entry */
    const writeEvent = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
    /** @type {import('../src/daemon.mjs').NodeAgentDaemon|undefined} */
    let daemon;
    let closing = false;
    /** @param {string} reason */
    const close = async (reason) => {
      if (closing) return;
      closing = true;
      await daemon?.close(reason);
    };
    try {
      daemon = await createNodeAgentDaemonFromFile({ configPath: args[configIndex + 1], logger: writeEvent });
      process.once('SIGINT', () => { void close('SIGINT').then(() => { process.exitCode = 0; }); });
      process.once('SIGTERM', () => { void close('SIGTERM').then(() => { process.exitCode = 0; }); });
      await daemon.start();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'daemon_start_failed';
      const message = error instanceof Error ? error.message : 'Node Agent daemon failed to start';
      process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
      await close('startup_failed');
      process.exitCode = 1;
    }
  }
}
