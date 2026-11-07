'use strict';

// Local Expo CLI output limits, retained after the Zod-free CLI update.
const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 1024;
const MAX_DEPTH = 16;
const MAX_NODES = 4096;
const errorResult = (reason) => ({ type: 'text', text: `Plugin output rejected: ${reason}.`, level: 'error' });
const checkText = (text) => Buffer.byteLength(text, 'utf8') > MAX_BYTES ? 'UTF-8 byte limit exceeded' : null;

function checkLines(text) {
  let count = 0;
  let nonempty = false;
  for (const character of text) {
    if (character === '\n') {
      if (nonempty && ++count > MAX_RECORDS) return 'line limit exceeded';
      nonempty = false;
    } else nonempty = true;
  }
  return count + Number(nonempty) > MAX_RECORDS ? 'line limit exceeded' : null;
}

function checkValue(value) {
  const stack = [[value, 0]];
  const seen = new Set();
  let nodes = 0;
  let bytes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++nodes > MAX_NODES) return 'node limit exceeded';
    if (depth > MAX_DEPTH) return 'depth limit exceeded';
    if (typeof item === 'string') bytes += Buffer.byteLength(item, 'utf8');
    else if (item && typeof item === 'object') {
      if (seen.has(item)) return 'cyclic or aliased value';
      seen.add(item);
      if (Array.isArray(item) && item.length > MAX_RECORDS) return 'array item limit exceeded';
      const keys = Object.keys(item);
      if (nodes + stack.length + keys.length > MAX_NODES) return 'node limit exceeded';
      for (const key of keys) {
        bytes += Buffer.byteLength(key, 'utf8');
        stack.push([item[key], depth + 1]);
      }
    } else bytes += 8;
    if (bytes > MAX_BYTES) return 'UTF-8 byte limit exceeded';
  }
  return null;
}

module.exports = { MAX_BYTES, MAX_RECORDS, MAX_DEPTH, MAX_NODES, errorResult, checkText, checkLines, checkValue };
