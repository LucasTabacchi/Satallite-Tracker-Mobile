import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Android launch builds the project native modules instead of assuming Expo Go', () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.android, 'expo run:android');
});

test('Android build has an explicit application identifier', () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'));
  assert.equal(config.expo.android?.package, 'dev.tp7.satellitetracker');
});
