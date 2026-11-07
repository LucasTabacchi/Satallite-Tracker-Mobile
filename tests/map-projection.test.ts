import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFootprint } from '../src/geometry';
import { interpolateLongitudeShortest, projectEquirectangular, splitPolylineAtDateline, splitPolygonAtDateline, type GeoCoordinate } from '../src/ui/map-projection';

test('projects both geographic poles and the antimeridian into the world frame', () => {
  assert.deepEqual(projectEquirectangular({ latitude: 90, longitude: -180 }, 360, 180), { x: 0, y: 0 });
  assert.deepEqual(projectEquirectangular({ latitude: -90, longitude: 180 }, 360, 180), { x: 360, y: 180 });
  assert.deepEqual(projectEquirectangular({ latitude: 0, longitude: 0 }, 360, 180), { x: 180, y: 90 });
});

test('splits line segments at the antimeridian without drawing across the world', () => {
  const paths = splitPolylineAtDateline([
    { latitude: 10, longitude: 170 },
    { latitude: 20, longitude: -170 },
  ]);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths[0], [{ latitude: 10, longitude: 170 }, { latitude: 15, longitude: 180 }]);
  assert.deepEqual(paths[1], [{ latitude: 15, longitude: -180 }, { latitude: 20, longitude: -170 }]);
});

test('interpolates telemetry through the antimeridian along the short arc', () => {
  assert.equal(interpolateLongitudeShortest(179, -179, 0), 179);
  assert.equal(interpolateLongitudeShortest(179, -179, 0.5), 180);
  assert.equal(interpolateLongitudeShortest(179, -179, 1), 181);
  assert.equal(interpolateLongitudeShortest(-179, 179, 0.5), -180);
});

test('clips wrapped polygons into narrow edge pieces instead of a whole-map fill', () => {
  const pieces = splitPolygonAtDateline([
    { latitude: -5, longitude: 170 },
    { latitude: -5, longitude: -170 },
    { latitude: 5, longitude: -170 },
    { latitude: 5, longitude: 170 },
  ]);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every(piece => piece.every(point => point.longitude >= -180 && point.longitude <= 180)));
  const widths = pieces.map(piece => Math.max(...piece.map(point => point.longitude)) - Math.min(...piece.map(point => point.longitude)));
  assert.ok(widths.every(width => width <= 10));
});

test('keeps pole-reaching polygons finite and within the projection bounds', () => {
  const points = Array.from({ length: 16 }, (_, index) => ({
    latitude: index % 2 ? 80 : 88,
    longitude: -180 + index * 22.5,
  }));
  const pieces = splitPolygonAtDateline(points);
  assert.ok(pieces.length >= 1);
  assert.ok(pieces.flat().every(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)));
  assert.ok(pieces.flat().every(point => Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180));
});

test('closes a polygon around the pole on the map edge instead of the equator', () => {
  const points = Array.from({ length: 8 }, (_, index) => ({ latitude: 80, longitude: -180 + index * 45 }));
  const pieces = splitPolygonAtDateline(points);
  assert.ok(pieces.flat().some(point => point.latitude === 90));
});

function insidePolygon(point: GeoCoordinate, polygon: GeoCoordinate[]) {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    if ((a.latitude > point.latitude) !== (b.latitude > point.latitude) &&
        point.longitude < a.longitude + (b.longitude - a.longitude) * (point.latitude - a.latitude) / (b.latitude - a.latitude)) {
      inside = !inside;
    }
  }
  return inside;
}

test('closes the wide GPS footprint at the pole without a diagonal across the map', () => {
  const footprint = calculateFootprint(20_000, 0, -42.86, -142.72);
  const pieces = splitPolygonAtDateline(footprint.coordinates);
  for (const piece of pieces) {
    for (let index = 0; index < piece.length; index++) {
      const a = piece[index]!;
      const b = piece[(index + 1) % piece.length]!;
      assert.ok(Math.abs(a.longitude - b.longitude) <= 90 || a.latitude === b.latitude,
        `Unexpected diagonal ${JSON.stringify([a, b])}`);
    }
  }
  assert.ok(pieces.some(piece => insidePolygon({ latitude: -88, longitude: 0 }, piece)));
  assert.ok(!pieces.some(piece => insidePolygon({ latitude: 70, longitude: -142.72 }, piece)));
});

test('projected coverage agrees with the spherical footprint across orbit heights, elevation settings, and poles', () => {
  const toRad = Math.PI / 180;
  for (const altitude of [400, 20_000, 36_000]) {
    for (const elevation of [0, 5, 10, 20, 30]) {
      for (const latitude of [-90, -75, -42.86, 0, 42.86, 75, 90]) {
        for (const longitude of [-179, -142.72, 0, 179]) {
          const footprint = calculateFootprint(altitude, elevation, latitude, longitude);
          const pieces = splitPolygonAtDateline(footprint.coordinates);
          assert.ok(pieces.length > 0);
          for (const probeLat of [-89, -75, -55, -30, -5, 15, 40, 65, 89]) {
            for (const probeLon of [-179.5, -145.5, -95.5, -30.5, 0.5, 55.5, 120.5, 179.5]) {
              const cosine = Math.sin(latitude * toRad) * Math.sin(probeLat * toRad) +
                Math.cos(latitude * toRad) * Math.cos(probeLat * toRad) * Math.cos((probeLon - longitude) * toRad);
              const distance = Math.acos(Math.max(-1, Math.min(1, cosine))) / toRad;
              if (Math.abs(distance - footprint.angularRadiusDeg) <= 2) continue; // Exclude the sampled boundary.
              assert.equal(pieces.some(piece => insidePolygon({ latitude: probeLat, longitude: probeLon }, piece)),
                distance < footprint.angularRadiusDeg, `Altitude ${altitude}, elevation ${elevation}, center ${latitude}/${longitude}, probe ${probeLat}/${probeLon}`);
            }
          }
        }
      }
    }
  }
});
