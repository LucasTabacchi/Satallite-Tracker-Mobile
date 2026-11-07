const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const source = process.env.TP7_CLI_FIXTURE;
assert.ok(source, 'Run this suite with the isolated CLI sandbox runner.');
const server = 'build/src/start/server/devtools';
const patcherPath = path.resolve(__dirname, '../scripts/patch-expo-cli.cjs');
const patcher = require(patcherPath);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-budget-'));
const target = path.join(root, server);
fs.mkdirSync(target, { recursive: true });
fs.symlinkSync('/deps/node_modules', path.join(root, 'node_modules'));
fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
for (const name of ['DevToolsPlugin.schema.js', 'DevToolsPluginCliExtensionResults.js']) {
  let content = fs.readFileSync(path.join(source, server, name), 'utf8');
  content = patcher.originalSource(name, content);
  fs.writeFileSync(path.join(target, name), content);
}
if (process.env.TP7_CLI_BASELINE !== '1') patcher.patchDirectory(root);
const { DevToolsPluginCliExtensionResults: Results } = require(path.join(target, 'DevToolsPluginCliExtensionResults.js'));
const output = (text = 'hello') => ({ type: 'text', text, level: 'info' });
const rejected = (result) => assert.equal(result[0]?.text?.startsWith('Plugin output rejected:'), true, 'Expected an explicit bounded rejection');
function collectorWithValidator(validate) {
  const filename = path.join(target, 'DevToolsPluginCliExtensionResults.js');
  const localRequire = createRequire(filename);
  const utils = localRequire('@expo/schema-utils');
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports, Buffer,
    require(name) { return name === '@expo/schema-utils' ? { ...utils, validate } : localRequire(name); },
  });
  return exports.DevToolsPluginCliExtensionResults;
}

test('rejects an excessive array before calling the output schema', () => {
  let called = false;
  const SpyResults = collectorWithValidator(() => { called = true; });
  rejected(new SpyResults().parseOutputText(JSON.stringify(Array.from({ length: 1025 }, () => output()))));
  assert.equal(called, false);
});

test('bounds raw bytes, plain-text lines, depth and total structural nodes', () => {
  const results = new Results();
  rejected(results.parseOutputText('é'.repeat(524289)));
  rejected(results.parseOutputText('x\n'.repeat(1025)));
  rejected(results.parseOutputText('['.repeat(18) + '0' + ']'.repeat(18)));
  const manyNodes = Array.from({ length: 1024 }, () => ({ a: 1, b: 2, c: 3, d: 4 }));
  rejected(results.parseOutputText(JSON.stringify(manyNodes)));
});

test('bounds accumulated output and publishes only one truncation notice', () => {
  const events = [];
  const results = new Results((rows) => events.push(rows));
  for (let index = 0; index < 1026; index++) results.append('x');
  assert.equal(results.isTruncated(), true);
  assert.ok(results.getOutput().length <= 1025);
  assert.equal(events.filter((rows) => rows[0]?.text.startsWith('Plugin output rejected:')).length, 1);
  const prior = JSON.stringify(results.getOutput());
  results.append('later');
  results.exit(9);
  assert.equal(JSON.stringify(results.getOutput()), prior);
});

test('preserves ordinary JSON, plain text, errors, callbacks and exit behavior', () => {
  const results = new Results();
  assert.deepEqual(results.parseOutputText(JSON.stringify([output()])), [output()]);
  assert.deepEqual(results.parseOutputText('one\n\ntwo', 'warning'), [
    { type: 'text', text: 'one', level: 'warning' },
    { type: 'text', text: 'two', level: 'warning' },
  ]);
  assert.match(results.parseOutputText('[{}]')[0].text, /^Invalid JSON:/);
  assert.deepEqual(results.parseOutputText('[]'), []);
  const calls = [];
  const active = new Results((rows) => calls.push(rows));
  active.append('first');
  active.exit(0);
  active.exit(2);
  assert.deepEqual(active.getOutput().map((row) => row.text), ['first', 'Process exited with code 2']);
  assert.equal(calls.length, 2);
  assert.equal(active.isTruncated(), false);
});

test('preserves unexpected validator failures rather than reporting plain-text success', () => {
  const BrokenResults = collectorWithValidator(() => { throw new Error('fixture validator failure'); });
  assert.throws(() => new BrokenResults().parseOutputText('[]'), /fixture validator failure/);
});

test('installation is idempotent and refuses unknown versions/bytes without writes', () => {
  patcher.patchDirectory(root);
  const before = fs.readFileSync(path.join(target, 'DevToolsPluginCliExtensionResults.js'), 'utf8');
  patcher.patchDirectory(root, true);
  patcher.patchDirectory(root);
  assert.equal(fs.readFileSync(path.join(target, 'DevToolsPluginCliExtensionResults.js'), 'utf8'), before);
  const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '58.1.16' }));
  assert.throws(() => patcher.patchDirectory(root), /requires @expo\/cli/);
  assert.equal(fs.readFileSync(path.join(target, 'DevToolsPluginCliExtensionResults.js'), 'utf8'), before);
  fs.writeFileSync(path.join(root, 'package.json'), manifest);
  const schemaFile = path.join(target, 'DevToolsPlugin.schema.js');
  const schema = fs.readFileSync(schemaFile, 'utf8');
  fs.writeFileSync(schemaFile, schema + '\n// changed upstream\n');
  assert.throws(() => patcher.patchDirectory(root), /hash mismatch/);
  assert.equal(fs.readFileSync(schemaFile, 'utf8'), schema + '\n// changed upstream\n');
  assert.equal(fs.readFileSync(path.join(target, 'DevToolsPluginCliExtensionResults.js'), 'utf8'), before);
  fs.writeFileSync(schemaFile, schema);
});

test('bounded outputs are byte-identical to the original vendor implementation', () => {
  const baselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-original-'));
  fs.symlinkSync('/deps/node_modules', path.join(baselineRoot, 'node_modules'));
  for (const name of ['DevToolsPlugin.schema.js', 'DevToolsPluginCliExtensionResults.js']) {
    fs.writeFileSync(path.join(baselineRoot, name), patcher.originalSource(name, fs.readFileSync(path.join(source, server, name), 'utf8')));
  }
  const Original = require(path.join(baselineRoot, 'DevToolsPluginCliExtensionResults.js')).DevToolsPluginCliExtensionResults;
  const cases = ['one\n\ntwo', '{not json', '[]', '[{}]', JSON.stringify([output('é')]), JSON.stringify([{ type: 'image', url: 'https://example.test/a.png' }])];
  const run = (Type) => {
    const callbacks = [];
    const instance = new Type((rows) => callbacks.push(rows));
    for (const input of cases) instance.append(input, 'warning');
    instance.exit(0);
    instance.exit(2);
    return JSON.stringify({ output: instance.getOutput(), callbacks, truncated: instance.isTruncated() });
  };
  assert.equal(run(Results), run(Original));
});

test('independent: exact UTF8/line/array boundaries and cumulative multibyte budget', () => {
  const budget = require('../scripts/cli-output-budget.cjs');
  assert.equal(budget.checkText('é'.repeat(524288)), null);
  assert.equal(budget.checkText('é'.repeat(524289)), 'UTF-8 byte limit exceeded');
  assert.equal(budget.checkLines('x\n'.repeat(1024)), null);
  assert.equal(budget.checkLines('x\n'.repeat(1025)), 'line limit exceeded');
  assert.equal(budget.checkValue(Array(1024).fill(0)), null);
  assert.equal(budget.checkValue(Array(1025).fill(0)), 'array item limit exceeded');
  const events = []; const instance = new Results(rows => events.push(rows));
  instance.append('é'.repeat(260000)); instance.append('é'.repeat(260000));
  instance.append('é'.repeat(5000));
  assert.equal(instance.isTruncated(), true);
  const prior = JSON.stringify(instance.getOutput());
  instance.append('more'); instance.exit(2);
  assert.equal(JSON.stringify(instance.getOutput()), prior);
  assert.equal(events.filter(rows => rows[0]?.text.startsWith('Plugin output rejected:')).length, 1);
});

test('independent: late vendor mismatch and unknown helper reject with all bytes unchanged', () => {
  const names = ['DevToolsPlugin.schema.js', 'DevToolsPluginCliExtensionResults.js', 'Tp7OutputBudget.cjs'];
  const snap = () => names.map(n => fs.readFileSync(path.join(target, n), 'utf8'));
  const collectorFile = path.join(target, names[1]); const original = fs.readFileSync(collectorFile, 'utf8');
  fs.writeFileSync(collectorFile, original + '\n// unexpected vendor bytes');
  const before = snap(); assert.throws(() => patcher.patchDirectory(root)); assert.deepEqual(snap(), before);
  fs.writeFileSync(collectorFile, original);
  const helperFile = path.join(target, names[2]); const helper = fs.readFileSync(helperFile, 'utf8');
  fs.writeFileSync(helperFile, helper + '\n// unexpected helper');
  const changed = snap(); assert.throws(() => patcher.patchDirectory(root), /Unknown local mitigation helper/); assert.deepEqual(snap(), changed);
  fs.writeFileSync(helperFile, helper);
});

test('collector keeps the published output schema unchanged', () => {
  const name = 'DevToolsPlugin.schema.js';
  assert.equal(fs.readFileSync(path.join(target, name), 'utf8'), fs.readFileSync(path.join(source, server, name), 'utf8'));
});
