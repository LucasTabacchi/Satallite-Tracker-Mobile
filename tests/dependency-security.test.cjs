const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = process.env.TP7_DEPENDENCY_ROOT;
assert.ok(root, 'Provide a read-only dependency snapshot in the isolated test runner.');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

test('the locked dependency graph contains no Zod version affected by GHSA-mrhx-c7xc-m3w5', () => {
  const vulnerable = [];
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (!location.endsWith('/zod') && entry.name !== 'zod') continue;
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(entry.version ?? '');
    const safe = match && (+match[1] > 4 || (+match[1] === 4 && (+match[2] > 6 || (+match[2] === 6 && +match[3] >= 6))));
    if (!safe) vulnerable.push(`${location}: ${entry.version}`);
  }
  assert.deepEqual(vulnerable, [], 'Upgrade the consuming dependency; do not suppress the advisory.');
});

test('the supported patch update stays on Expo SDK 58', () => {
  assert.match(lock.packages['node_modules/expo'].version, /^58\.0\./);
  const cli = lock.packages['node_modules/expo/node_modules/@expo/cli'];
  assert.ok(cli, 'Expected the Expo-owned CLI dependency.');
  assert.equal(cli.dependencies?.zod, undefined, 'The updated CLI must not reintroduce Zod 3.');
});
