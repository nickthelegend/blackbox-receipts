import { readFileSync } from 'node:fs';
import { parseLine } from './parse.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tally <file>');
  process.exit(2);
}
let total = 0;
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const value = parseLine(line);
  if (value !== null) total += value;
}
console.log(total);
