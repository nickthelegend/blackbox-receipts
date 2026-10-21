#!/usr/bin/env node
// blackbox-verify <pack.json> [--public-key key.pem] [--json]
// Checks a Blackbox pack (blackbox-pack/v1) from the file alone: signatures, hash links, the signed seal
// and the property proof, with the same verifyPack the CLI and the browser verifier run. No network, no
// private key. Exit 0 PASS, 1 FAIL, 2 usage or unreadable input.
// This file is the Node entry point; the library itself (index.ts) has no node: imports.
import { readFileSync } from 'node:fs';
import { parsePack, verifyPack, type Pack } from './index.js';

const VERSION = '0.1.0';
const USAGE = `Usage: blackbox-verify <pack.json> [--public-key key.pem] [--json]

Verifies a Blackbox Receipts pack offline: every receipt's Ed25519 signature and hash link, the signed
seal (nothing cut off the end) and the no-secrets-read property proof under policy no-secrets-read/v1.
  --public-key <file>  require the pack to be signed by this PEM key (or set BLACKBOX_PUBLIC_KEY)
  --json               print the full result as JSON
Exit codes: 0 PASS, 1 FAIL, 2 usage error or unreadable file.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
if (args.includes('--version')) { console.log(VERSION); process.exit(0); }
const keyIndex = args.indexOf('--public-key');
const files = args.filter((arg, index) => !arg.startsWith("--") && (keyIndex < 0 || index !== keyIndex + 1));
if (files.length !== 1 || (keyIndex >= 0 && !args[keyIndex + 1])) { console.error(USAGE); process.exit(2); }

let pack: Pack;
let pinnedPublicKey: string | undefined;
try {
  pack = parsePack(readFileSync(files[0], 'utf8'));
  pinnedPublicKey = keyIndex >= 0 ? readFileSync(args[keyIndex + 1], 'utf8') : process.env.BLACKBOX_PUBLIC_KEY || undefined;
} catch (error) {
  console.error(`FAIL: cannot read ${files[0]}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const result = verifyPack(pack, { pinnedPublicKey });
if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log(result.headline);
  for (const check of result.checks) console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
  const marked = result.steps.filter((step) => step.status !== 'ok');
  for (const step of marked) console.log(`  step ${step.step} ${step.status}: ${step.tool} ${step.paths.filter(Boolean).join(' ')}${step.reason ? ` (${step.reason})` : ''}`.replace(/\s+\(/, ' ('));
  if (result.root) console.log(`  session ${result.sessionId}, Merkle root ${result.root}`);
}
process.exit(result.ok ? 0 : 1);
