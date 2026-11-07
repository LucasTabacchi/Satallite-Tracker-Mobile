import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CelesTrakProvider } from '../src/providers/celestrak';
import { WhereTheIssProvider } from '../src/providers/wheretheiss';
import { ProxyProvider } from '../src/providers/proxy-client';
import { buildValidationEvidence, renderValidationReport, type ValidationEvidence } from '../src/validation-report';
import type { ValidationPosition } from '../src/providers/types';

const usage = `Usage: npx tsx scripts/validate-live.ts --live --output <directory> [--norad <id>] [--proxy <https-url>]

Explicitly collects three timestamp-aligned public ISS samples (one CelesTrak fetch,
three Where the ISS at? calls, at least 1.1 seconds apart), without automatic retries.
For another NORAD ID, --proxy is required for N2YO validation. A proxy URL is public
configuration, never a credential. No environment secrets or ambient sessions are read.
Writes a NEW timestamped Markdown report and raw JSON; never overwrites past reports.
An upstream failure exits nonzero without manufacturing a successful comparison.
--help shows this message without network access.`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  let live = false, output = '', proxy = '', norad = 25544;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--live') live = true;
    else if (['--output', '--proxy', '--norad'].includes(option) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const value = args[++i];
      if (option === '--output') output = value;
      else if (option === '--proxy') proxy = value;
      else norad = Number(value);
    } else throw new Error(`Unknown or incomplete option: ${option}\n${usage}`);
  }
  if (!live || !output || !Number.isSafeInteger(norad) || norad < 1 || norad > 999999999) throw new Error(usage);
  if (norad !== 25544 && !proxy) throw new Error('Non-ISS validation requires an explicitly configured N2YO proxy.');
  // Reject redirects and use existing timeout/error validation. No automatic retry.
  const request: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' });
  const providers = [ ...(norad === 25544 ? [new WhereTheIssProvider(request)] : []),
    ...(proxy ? [new ProxyProvider('n2yo', proxy, request)] : []) ];
  const elements = (await new CelesTrakProvider(request).getOrbitalData({ noradId: norad }))[0];
  if (!elements || elements.NORAD_CAT_ID !== norad) throw new Error('CelesTrak returned no matching satellite.');
  const evidence: ValidationEvidence[] = [];
  for (const provider of providers) {
    const references: ValidationPosition[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const at = new Date(Math.floor(Date.now() / 1000) * 1000);
      references.push(await provider.getValidationPosition({ noradId: norad, at,
        observer: { latitude: 0, longitude: 0, altitudeKm: 0 } }));
    }
    evidence.push(buildValidationEvidence(elements, references, provider.id, new Date()));
  }
  const directory = resolve(output);
  const stem = `validation-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${stem}.json`), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, `${stem}.md`), renderValidationReport(evidence), { flag: 'wx' });
  console.log(JSON.stringify({ directory, stem, samples: evidence.flatMap(item => item.rows).length }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
