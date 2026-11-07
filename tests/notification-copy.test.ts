import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationCopy } from '../src/notification-copy';

test('native pass notification uses neutral Spanish and retains name and lead time', () => {
  assert.deepEqual(notificationCopy('ISS (ZARYA)', 5), {
    title: 'Próximo pase: ISS (ZARYA)', body: 'El pase comienza en 5 minutos.',
  });
  assert.equal(notificationCopy('HUBBLE', 1).body, 'El pase comienza en 1 minuto.');
});
