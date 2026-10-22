// One process contending for the receipt-log lock: waits for the go file, then holds the lock for a
// moment, writing when it enters and leaves, so a test can check no two holders ever overlap.
import { appendFileSync, existsSync } from 'node:fs';
import { withSessionLock } from '../../packages/proxy/src/store.ts';

const [goFile, outFile] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
appendFileSync(outFile, `ready ${process.pid}\n`);
while (!existsSync(goFile)) await sleep(1);
await withSessionLock(async () => {
  appendFileSync(outFile, `enter ${process.pid}\n`);
  await sleep(120);
  appendFileSync(outFile, `exit ${process.pid}\n`);
});
