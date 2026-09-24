import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadState, saveState } from '../src/state';
import type { State } from '../src/types';

describe('state file', () => {
  it('round-trips targets and exchange rates', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prices-')), 'prices.json');
    const state: State = {
      version: 1,
      updatedAt: '2026-09-24T06:00:00Z',
      fx: { date: '2026-09-23', perGbp: { EUR: 1.163 } },
      targets: { kef: { name: 'KEF', retailer: 'KEF UK', url: 'u', lastPrice: 699, currency: 'GBP', consecutiveFailures: 0, failureAlerted: false, history: [] } },
    };
    saveState(state, file);
    expect(loadState(file)).toEqual(state);
  });

  it('starts empty when there is no file yet', () => {
    expect(loadState(path.join(os.tmpdir(), 'does-not-exist', 'prices.json'))).toEqual({ version: 1, targets: {} });
  });
});
