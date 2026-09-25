import fs from 'node:fs';
import path from 'node:path';
import type { State } from './types';

export const STATE_PATH = path.resolve(process.env.PRICES_FILE ?? 'data/prices.json');

export function loadState(file = STATE_PATH): State {
  if (!fs.existsSync(file)) return { version: 1, targets: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as State;
  // Keep every saved section (fx, exdemo, ...), so a new one can't be dropped by accident.
  return { ...parsed, version: 1, targets: parsed.targets ?? {} };
}

export function saveState(state: State, file = STATE_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
