'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const VERSION = '58.1.19';
const server = 'build/src/start/server/devtools';
const helperName = 'Tp7OutputBudget.cjs';
const helper = fs.readFileSync(path.join(__dirname, 'cli-output-budget.cjs'), 'utf8');
const hashes = {
  'DevToolsPlugin.schema.js': '223153f9e6e2706e2e32e4bd8b25ee98b29c5682e862f65966093e8d934e79d6',
  'DevToolsPluginCliExtensionResults.js': 'b1b370abd2c05a281a7fa8bc8600702002bc69bf4079026bdf12b074a1ee60fa',
};
const importBudget = 'const _tp7Budget = require("./Tp7OutputBudget.cjs");\n';
const retention = `        const retainedBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
        if (this._output.length + results.length > _tp7Budget.MAX_RECORDS || (this._retainedBytes ?? 0) + retainedBytes > _tp7Budget.MAX_BYTES) {
            this._truncated = true;
            const notice = _tp7Budget.errorResult('accumulated output limit exceeded');
            this._output.push(notice);
            this.onOutput?.([notice]);
            return;
        }
        this._retainedBytes = (this._retainedBytes ?? 0) + retainedBytes;
`;
const replacements = {
  'DevToolsPluginCliExtensionResults.js': [
    ["// Cap accumulated output at V8's max single-string length to bound heap growth.", '// Local practical UTF-8 budget, retained after the Zod-free CLI update.'],
    ['const _DevToolsPluginschema = require("./DevToolsPlugin.schema");', importBudget + 'const _DevToolsPluginschema = require("./DevToolsPlugin.schema");'],
    ['const MAX_OUTPUT_LENGTH = _nodebuffer().constants.MAX_STRING_LENGTH;', 'const MAX_OUTPUT_LENGTH = _tp7Budget.MAX_BYTES;'],
    ['this._totalLength + output.length', "this._totalLength + Buffer.byteLength(output, 'utf8')"],
    ['text: `Output truncated: plugin exceeded V8\'s max string length (${MAX_OUTPUT_LENGTH} chars). Reduce output, paginate, or write to a file.`,', "text: 'Plugin output rejected: accumulated UTF-8 byte limit exceeded.',"],
    ['this._totalLength += output.length;', "this._totalLength += Buffer.byteLength(output, 'utf8');"],
    ['        this._output.push(...results);', retention + '        this._output.push(...results);'],
    ["    parseOutputText(txt, level = 'info') {", "    parseOutputText(txt, level = 'info') {\n        const byteReason = _tp7Budget.checkText(txt);\n        if (byteReason) return [_tp7Budget.errorResult(byteReason)];"],
    ['            (0, _schemautils().validate)(_DevToolsPluginschema.DevToolsPluginOutputSchema, output);', '            const reason = _tp7Budget.checkValue(output);\n            if (reason) return [_tp7Budget.errorResult(reason)];\n            (0, _schemautils().validate)(_DevToolsPluginschema.DevToolsPluginOutputSchema, output);'],
    ["            const lines = txt.split('\\n');", "            const lineReason = _tp7Budget.checkLines(txt);\n            if (lineReason) return [_tp7Budget.errorResult(lineReason)];\n            const lines = txt.split('\\n');"],
  ],
};

function transform(name, source, reverse = false) {
  const changes = reverse ? [...(replacements[name] ?? [])].reverse() : replacements[name] ?? [];
  for (const [before, after] of changes) {
    const from = reverse ? after : before;
    const to = reverse ? before : after;
    if (source.split(from).length !== 2) throw new Error(`Unsupported Expo CLI source: ${name}`);
    source = source.replace(from, to);
  }
  return source;
}

function originalSource(name, source) {
  if (hash(source) === hashes[name]) return source;
  const original = transform(name, source, true);
  if (hash(original) !== hashes[name]) throw new Error(`Expo CLI hash mismatch: ${name}`);
  return original;
}

function patchDirectory(root, checkOnly = false) {
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== VERSION) {
    throw new Error(`Local mitigation requires @expo/cli ${VERSION}; revalidate before upgrading.`);
  }
  // Validate every source before writing any file. Unknown vendor changes fail closed.
  const planned = Object.keys(hashes).map((name) => {
    const filename = path.join(root, server, name);
    if (!fs.lstatSync(filename).isFile()) throw new Error(`Expected a regular vendor file: ${name}`);
    const current = fs.readFileSync(filename, 'utf8');
    return [filename, current, transform(name, originalSource(name, current))];
  });
  const helperFile = path.join(root, server, helperName);
  if (fs.existsSync(helperFile) && !fs.lstatSync(helperFile).isFile()) throw new Error('Expected a regular mitigation helper.');
  if (fs.existsSync(helperFile) && fs.readFileSync(helperFile, 'utf8') !== helper) {
    throw new Error('Unknown local mitigation helper; refusing to overwrite it.');
  }
  if (checkOnly) {
    if (!fs.existsSync(helperFile) || planned.some(([, current, next]) => current !== next)) throw new Error('Expo CLI mitigation is not installed.');
    return;
  }
  writeAtomic(helperFile, helper);
  for (const [filename, current, next] of planned) if (current !== next) writeAtomic(filename, next);
}

function writeAtomic(filename, content) {
  const temporary = `${filename}.tp7-${process.pid}.tmp`;
  let created = false;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o644 });
    created = true;
    fs.renameSync(temporary, filename);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

if (require.main === module) {
  try {
    if (process.argv.includes('--help')) console.log('Usage: node scripts/patch-expo-cli.cjs [--check]\nInstalls/checks version-pinned local plugin-output limits on the Zod-free CLI.');
    else {
      if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Unknown option; use --help.');
      const expoRoot = path.dirname(require.resolve('expo/package.json', { paths: [path.join(__dirname, '..')] }));
      const cliRoot = path.dirname(require.resolve('@expo/cli/package.json', { paths: [expoRoot] }));
      patchDirectory(cliRoot, process.argv.includes('--check'));
      console.log('Local output limits verified for Expo CLI 58.1.19 (no production Zod dependency).');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { patchDirectory, originalSource };
