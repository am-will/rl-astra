import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
// Include every shared source dependency, including geometry and physics tuning.
export function simulationBuild() {
  const files = readdirSync('src', { recursive: true }).filter(f => /\.ts$/.test(f)).map(f => `src/${f}`).sort();
  const hash = createHash('sha256');
  for (const file of [...files, 'package-lock.json']) hash.update(file).update(readFileSync(file));
  return hash.digest('hex').slice(0, 20);
}
