const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inflateRawSync } = require('node:zlib');

const SOURCE_URL = 'https://naturalearth.s3.amazonaws.com/110m_physical/ne_110m_land.zip';
const SOURCE_PAGE = 'https://www.naturalearthdata.com/downloads/110m-physical-vectors/';
const TERMS_URL = 'https://www.naturalearthdata.com/about/terms-of-use/';
const OUTPUT = path.join(__dirname, '..', 'src', 'ui', 'world-land.json');

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => https.get(url, response => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
      response.resume();
      download(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject);
      return;
    }
    if (response.statusCode !== 200) {
      response.resume();
      reject(new Error(`Dataset download failed: HTTP ${response.statusCode}`));
      return;
    }
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', reject));
}

function readZipEntry(zip, suffix) {
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65_557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end-of-directory record missing');
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name.endsWith(suffix)) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${suffix}`);
}

function parsePolygonShapefile(shp) {
  if (shp.readInt32BE(0) !== 9994 || shp.readInt32LE(28) !== 1000) throw new Error('Invalid ESRI shapefile header');
  const features = [];
  for (let offset = 100; offset + 8 <= shp.length;) {
    const recordBytes = shp.readInt32BE(offset + 4) * 2;
    const start = offset + 8;
    const end = start + recordBytes;
    if (end > shp.length) throw new Error('Truncated shapefile record');
    const shapeType = shp.readInt32LE(start);
    if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
      const partCount = shp.readInt32LE(start + 36);
      const pointCount = shp.readInt32LE(start + 40);
      const partsOffset = start + 44;
      const pointsOffset = partsOffset + partCount * 4;
      const parts = Array.from({ length: partCount }, (_, index) => shp.readInt32LE(partsOffset + index * 4));
      parts.push(pointCount);
      const rings = [];
      for (let part = 0; part < partCount; part++) {
        const ring = [];
        for (let point = parts[part]; point < parts[part + 1]; point++) {
          const coordinate = pointsOffset + point * 16;
          ring.push([shp.readDoubleLE(coordinate), shp.readDoubleLE(coordinate + 8)]);
        }
        if (ring.length >= 4) rings.push(ring);
      }
      if (rings.length) features.push(rings);
    }
    offset = end;
  }
  if (!features.length) throw new Error('No land polygon rings found');
  return features;
}

async function main() {
  const archivePath = process.argv[2];
  const archive = archivePath ? fs.readFileSync(archivePath) : await download(SOURCE_URL);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const polygons = parsePolygonShapefile(readZipEntry(archive, 'ne_110m_land.shp'));
  const output = {
    source: SOURCE_URL,
    sourcePage: SOURCE_PAGE,
    license: 'Public domain',
    terms: TERMS_URL,
    sourceSha256: digest,
    polygons,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
  process.stdout.write(`Generated ${OUTPUT} with ${polygons.length} rings from SHA-256 ${digest}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
