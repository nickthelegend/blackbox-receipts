/** Parses one line of input. Blank lines and `#` comments yield null. */
export function parseLine(line: string): number | null {
  const text = line.trim();
  if (!text || text.startsWith('#')) return null;
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) throw new Error(`Not a number: ${text}`);
  return value;
}
