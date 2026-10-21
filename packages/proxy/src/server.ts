// Entry point of the Blackbox MCP proxy (stdio): `node dist/server.js [--cwd <workspace>]`.
// Options are applied before the proxy modules load, so the store resolves paths in the right directory.
const argv = process.argv.slice(2);
const cwdIndex = argv.indexOf('--cwd');
if (cwdIndex >= 0) {
  const dir = argv[cwdIndex + 1];
  if (!dir) { console.error('blackbox-proxy: --cwd needs a directory'); process.exit(2); }
  process.chdir(dir);
}
await import('./serve.js');
