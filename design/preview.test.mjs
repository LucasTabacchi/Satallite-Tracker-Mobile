import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchCatalog, toggleReminder } from './preview-model.mjs';

const rows = [
  { id: 25544, name: 'ISS (ZARYA)', group: 'stations' },
  { id: 20580, name: 'HUBBLE', group: 'science' },
  { id: 44713, name: 'STARLINK-1007', group: 'constellations' },
];

test('preview declares Spanish and labels navigation and search in Spanish', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="es">/);
  for (const label of ['Seguimiento', 'Cielo', 'Pases', 'Catálogo', 'Buscar satélites por nombre o ID NORAD']) {
    assert.ok(html.includes(label), `Missing Spanish interface label: ${label}`);
  }
});

test('preview search matches names case-insensitively and NORAD IDs', () => {
  assert.deepEqual(searchCatalog(rows, '  hubb  '), [rows[1]]);
  assert.deepEqual(searchCatalog(rows, '25544'), [rows[0]]);
  assert.deepEqual(searchCatalog(rows, 'not found'), []);
  assert.deepEqual(searchCatalog(rows, ''), rows);
});

test('preview group and search filters combine without mutating fixtures', () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(searchCatalog(rows, '', 'stations'), [rows[0]]);
  assert.deepEqual(searchCatalog(rows, 'ISS', 'science'), []);
  assert.equal(JSON.stringify(rows), before);
});

test('preview reminder toggles are reversible, independent and memory-only', () => {
  const initial = ['pass-1'];
  const added = toggleReminder(initial, 'pass-2');
  assert.deepEqual(added, ['pass-1', 'pass-2']);
  assert.deepEqual(toggleReminder(added, 'pass-1'), ['pass-2']);
  assert.deepEqual(toggleReminder(added, 'pass-2'), initial);
  assert.deepEqual(initial, ['pass-1']);
});
