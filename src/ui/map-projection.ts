export type GeoCoordinate = { latitude: number; longitude: number };
export type ProjectedPoint = { x: number; y: number };

export function interpolateLongitudeShortest(from: number, to: number, progress: number): number {
  let target = to;
  while (target - from > 180) target -= 360;
  while (target - from < -180) target += 360;
  return from + (target - from) * Math.max(0, Math.min(1, progress));
}

export function projectEquirectangular(point: GeoCoordinate, width: number, height: number): ProjectedPoint {
  const longitude = Math.max(-180, Math.min(180, point.longitude));
  const latitude = Math.max(-90, Math.min(90, point.latitude));
  return { x: ((longitude + 180) / 360) * width, y: ((90 - latitude) / 180) * height };
}

export function splitPolylineAtDateline(points: GeoCoordinate[]): GeoCoordinate[][] {
  if (points.length === 0) return [];
  const paths: GeoCoordinate[][] = [[points[0]!]];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const delta = point.longitude - previous.longitude;
    if (Math.abs(delta) <= 180) {
      paths.at(-1)!.push(point);
      continue;
    }
    const adjustedLongitude = point.longitude + (delta > 180 ? -360 : 360);
    const edge = delta > 180 ? -180 : 180;
    const fraction = (edge - previous.longitude) / (adjustedLongitude - previous.longitude);
    const latitude = previous.latitude + (point.latitude - previous.latitude) * fraction;
    paths.at(-1)!.push({ latitude, longitude: edge });
    paths.push([{ latitude, longitude: -edge }, point]);
  }
  return paths.filter(path => path.length > 1);
}

function clipVertical(points: GeoCoordinate[], edge: number, keepGreater: boolean): GeoCoordinate[] {
  const result: GeoCoordinate[] = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const previous = points[(index + points.length - 1) % points.length]!;
    const currentInside = keepGreater ? current.longitude >= edge : current.longitude <= edge;
    const previousInside = keepGreater ? previous.longitude >= edge : previous.longitude <= edge;
    if (currentInside !== previousInside) {
      const fraction = (edge - previous.longitude) / (current.longitude - previous.longitude);
      result.push({ latitude: previous.latitude + (current.latitude - previous.latitude) * fraction, longitude: edge });
    }
    if (currentInside) result.push(current);
  }
  return result;
}

export function splitPolygonAtDateline(points: GeoCoordinate[]): GeoCoordinate[][] {
  if (points.length < 3) return [];
  const unwrapped = [points[0]!];
  for (const point of points.slice(1)) {
    const previous = unwrapped.at(-1)!;
    let longitude = point.longitude;
    while (longitude - previous.longitude > 180) longitude -= 360;
    while (longitude - previous.longitude < -180) longitude += 360;
    unwrapped.push({ latitude: point.latitude, longitude });
  }
  const first = points[0]!;
  const last = unwrapped.at(-1)!;
  let closingLongitude = first.longitude;
  while (closingLongitude - last.longitude > 180) closingLongitude -= 360;
  while (closingLongitude - last.longitude < -180) closingLongitude += 360;
  if (Math.abs(closingLongitude - first.longitude) > 180) {
    const poleLatitude = points.reduce((sum, point) => sum + point.latitude, 0) >= 0 ? 90 : -90;
    // Finish the spherical ring in the adjacent world, then close along the pole.
    unwrapped.push(
      { latitude: first.latitude, longitude: closingLongitude },
      { latitude: poleLatitude, longitude: closingLongitude },
      { latitude: poleLatitude, longitude: first.longitude },
    );
  }
  const minLongitude = Math.min(...unwrapped.map(point => point.longitude));
  const maxLongitude = Math.max(...unwrapped.map(point => point.longitude));
  const pieces: GeoCoordinate[][] = [];
  for (let shift = -360; shift <= 360; shift += 360) {
    if (maxLongitude + shift < -180 || minLongitude + shift > 180) continue;
    const shifted = unwrapped.map(point => ({ ...point, longitude: point.longitude + shift }));
    const clipped = clipVertical(clipVertical(shifted, -180, true), 180, false);
    if (clipped.length >= 3) pieces.push(clipped.map(point => ({ ...point, latitude: Math.max(-90, Math.min(90, point.latitude)) })));
  }
  return pieces;
}
