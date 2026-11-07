import type { Elements } from './orbit';
import type { ValidationPosition } from './providers/types';
import { comparePosition, type ValidationRow } from './validation';

export type ValidationEvidence = {
  capturedAt: string;
  elements: Elements;
  references: ValidationPosition[];
  rows: ValidationRow[];
};

export function buildValidationEvidence(elements: Elements, references: ValidationPosition[], provider: string, capturedAt: Date): ValidationEvidence {
  if (!references.length) throw new Error('No reference positions supplied');
  const rows = references.map(reference => comparePosition(elements, reference, reference.timestamp,
    { latitude: 0, longitude: 0, altitudeKm: 0 }, provider, capturedAt.getTime()));
  return { capturedAt: capturedAt.toISOString(), elements, references, rows };
}

export function renderValidationReport(evidence: ValidationEvidence[]): string {
  if (!evidence.length) throw new Error('No evidence supplied');
  const rows = evidence.flatMap(item => item.rows);
  const safe = (text: string) => text.replace(/[|\r\n]/g, ' ');
  const lines = rows.map(row => `| ${safe(row.provider)} | ${row.noradId} | ${row.timestamp} | ${safe(row.orbitalEpoch)} | ${(row.orbitalAgeMs / 3_600_000).toFixed(3)} | ${row.errorKm.toFixed(6)} | ${row.surfaceErrorKm.toFixed(6)} | ${row.altitudeErrorKm.toFixed(6)} |`);
  return [
    '# Independent position comparison', '',
    `Captured: ${evidence.map(item => item.capturedAt).join(', ')}`, '',
    'Local SGP4 and the reference are evaluated at the exact same UTC second. Error is the 3D Euclidean distance between WGS84 Earth-fixed positions, in kilometers. Surface error is a zero-altitude ECEF chord, not geodesic arc distance. Orbital age is measured at capture.', '',
    '| Reference | NORAD | UTC timestamp | Element epoch | Age (h) | 3D error (km) | Surface chord (km) | Altitude error (km) |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |', ...lines, '',
    '## Interpretation and limits', '',
    `- Maximum observed 3D discrepancy: ${Math.max(...rows.map(row => row.errorKm)).toFixed(6)} km over ${rows.length} samples.`,
    '- Provider agreement is not ground-truth orbit accuracy: sources may share orbital inputs, and epoch age/model differences affect the discrepancy.',
    '- This is not a physical-device, compass, notification, or optical-visibility acceptance test.',
    rows.some(row => row.provider === 'n2yo') ? '- N2YO evidence is included above.' : '- N2YO: not collected; an explicitly configured authenticated server proxy is required.',
    '- Preserve the accompanying JSON: it contains the orbital elements and reference positions needed to reproduce the calculation.', '',
  ].join('\n');
}
