#!/usr/bin/env node
import { probeAllRuntimes } from '../src/runtime-probes.mjs';

const [command, ...args] = process.argv.slice(2);

if (command !== 'probe') {
  process.stderr.write('Usage: hummer-node probe [--other-executable <name-or-path>]\n');
  process.exitCode = 2;
} else {
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
}
