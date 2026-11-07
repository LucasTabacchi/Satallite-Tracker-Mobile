import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { calculateFootprint, type GroundTrack } from '../geometry';
import type { Observer } from '../orbit';
import worldLand from './world-land.json';
import { interpolateLongitudeShortest, projectEquirectangular, splitPolygonAtDateline, splitPolylineAtDateline, type GeoCoordinate } from './map-projection';

export type OrbitMapProps = {
  position?: { latitude: number; longitude: number };
  groundTrack?: GroundTrack;
  footprint?: ReturnType<typeof calculateFootprint>;
  observer?: Observer;
  constellation?: Array<{ noradId: number; latitude: number; longitude: number }>;
  onSelectSatellite?: (id: number) => void;
};

type MapLand = { sourceSha256: string; polygons: number[][][][] };
const land = worldLand as unknown as MapLand;
const PALETTE = {
  background: '#101816',
  ocean: '#19231e',
  land: '#eef0e5',
  subdued: '#a4b0a2',
  accent: '#d1f5a2',
};
const MAP_WIDTH = 360;
const MAP_HEIGHT = 180;
const MAX_CONSTELLATION_MARKERS = 50;

function mapCoordinate(point: GeoCoordinate) {
  return projectEquirectangular(point, MAP_WIDTH, MAP_HEIGHT);
}

function worldPath(points: GeoCoordinate[], close = false) {
  if (points.length === 0) return '';
  const projected = points.map(mapCoordinate);
  return `${projected.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}${close ? ' Z' : ''}`;
}

function landPath(rings: number[][][]) {
  return rings.map(ring => worldPath(ring.map(([longitude, latitude]) => ({ latitude: latitude!, longitude: longitude! })), true)).join(' ');
}

function Marker({ latitude, longitude, color, radius, label, onPress }: {
  latitude: number;
  longitude: number;
  color: string;
  radius: number;
  label: string;
  onPress?: () => void;
}) {
  const point = mapCoordinate({ latitude, longitude });
  const x = ((longitude + 180) / 360) * MAP_WIDTH;
  const offsets = [x - MAP_WIDTH, x, x + MAP_WIDTH].filter(value => value >= -radius && value <= MAP_WIDTH + radius);
  return <G accessibilityLabel={label} accessibilityRole={onPress ? 'button' : undefined} onPress={onPress}>
    {onPress && offsets.map((markerX, index) => <Circle key={`hit-${index}`} cx={markerX} cy={point.y} r={27} fill="transparent" />)}
    {offsets.map((markerX, index) => <G key={index}>
      <Circle cx={markerX} cy={point.y} r={radius + 3} fill={PALETTE.background} opacity={0.8} />
      <Circle cx={markerX} cy={point.y} r={radius} fill={color} stroke={PALETTE.background} strokeWidth={1.5} />
    </G>)}
  </G>;
}

function LayerButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.layerButton, selected && styles.layerButtonSelected]}>
    <Text style={[styles.layerText, selected && styles.layerTextSelected]}>{label}</Text>
  </Pressable>;
}

export function OrbitMap({ position, groundTrack, footprint, observer, constellation = [], onSelectSatellite }: OrbitMapProps) {
  const [showTrack, setShowTrack] = useState(true);
  const [showFootprint, setShowFootprint] = useState(true);
  const [showConstellation, setShowConstellation] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [animatedPosition, setAnimatedPosition] = useState(position);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!position) { setAnimatedPosition(undefined); return; }
    if (!animatedPosition || reduceMotion) { setAnimatedPosition(position); return; }
    const start = Date.now();
    const duration = 1800;
    const from = animatedPosition;
    let frame = 0;
    let cancelled = false;
    const animate = () => {
      if (cancelled) return;
      const progress = Math.min(1, (Date.now() - start) / duration);
      setAnimatedPosition({
        latitude: from.latitude + (position.latitude - from.latitude) * progress,
        longitude: interpolateLongitudeShortest(from.longitude, position.longitude, progress),
      });
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  // Telemetry is supplied at two-second intervals; animate each sample, not stale object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.latitude, position?.longitude, reduceMotion]);

  const center = animatedPosition ?? position ?? { latitude: 0, longitude: 0 };
  const projectedCenter = mapCoordinate(center);
  const viewWidth = MAP_WIDTH / zoom;
  const viewHeight = MAP_HEIGHT / zoom;
  const viewX = Math.max(0, Math.min(MAP_WIDTH - viewWidth, projectedCenter.x - viewWidth / 2));
  const viewY = Math.max(0, Math.min(MAP_HEIGHT - viewHeight, projectedCenter.y - viewHeight / 2));
  const viewBox = `${viewX} ${viewY} ${viewWidth} ${viewHeight}`;
  const landPaths = useMemo(() => land.polygons.map(landPath), []);
  const trackPaths = useMemo(() => showTrack && groundTrack ? groundTrack.segments.flatMap(segment =>
    splitPolylineAtDateline(segment.map(point => ({ latitude: point.latitude, longitude: point.longitude }))).map(path => worldPath(path)),
  ) : [], [groundTrack, showTrack]);
  const footprintPaths = useMemo(() => {
    const points = showFootprint ? footprint?.coordinates : undefined;
    if (!points?.length) return { fill: '', outline: [] };
    return {
      fill: splitPolygonAtDateline(points).map(piece => worldPath(piece, true)).join(' '),
      // The fill closes at map edges and poles; those closures are not coverage boundaries.
      outline: splitPolylineAtDateline([...points, points[0]!]).map(piece => worldPath(piece)),
    };
  }, [footprint, showFootprint]);
  const visibleSatellites = showConstellation ? constellation.slice(0, MAX_CONSTELLATION_MARKERS) : [];

  return <View style={styles.container}>
    <View style={styles.toolbar}>
      <LayerButton label="Trayectoria" selected={showTrack} onPress={() => setShowTrack(value => !value)} />
      <LayerButton label="Cobertura" selected={showFootprint} onPress={() => setShowFootprint(value => !value)} />
      <LayerButton label={`Constelación (${Math.min(constellation.length, MAX_CONSTELLATION_MARKERS)})`} selected={showConstellation} onPress={() => setShowConstellation(value => !value)} />
      <View style={styles.zoomControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Acercar mapa" disabled={zoom >= 4} onPress={() => setZoom(value => Math.min(4, value * 1.5))} style={[styles.zoomButton, zoom >= 4 && styles.disabledButton]}><Text style={styles.zoomText}>+</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Alejar mapa" disabled={zoom <= 1} onPress={() => setZoom(value => Math.max(1, value / 1.5))} style={[styles.zoomButton, zoom <= 1 && styles.disabledButton]}><Text style={styles.zoomText}>−</Text></Pressable>
      </View>
    </View>
    <Svg width="100%" height={210} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" accessibilityLabel="Mapa mundial de satélites">
      <Rect x={0} y={0} width={MAP_WIDTH} height={MAP_HEIGHT} fill={PALETTE.ocean} />
      {Array.from({ length: 11 }, (_, index) => {
        const latitude = -90 + index * 18;
        const y = mapCoordinate({ latitude, longitude: 0 }).y;
        return <Line key={`lat-${latitude}`} x1={0} x2={MAP_WIDTH} y1={y} y2={y} stroke={PALETTE.subdued} strokeOpacity={0.2} strokeWidth={0.25} />;
      })}
      {Array.from({ length: 12 }, (_, index) => {
        const longitude = -180 + index * 30;
        const x = mapCoordinate({ latitude: 0, longitude }).x;
        return <Line key={`lon-${longitude}`} y1={0} y2={MAP_HEIGHT} x1={x} x2={x} stroke={PALETTE.subdued} strokeOpacity={0.2} strokeWidth={0.25} />;
      })}
      {landPaths.map((path, index) => <Path key={`land-${index}`} d={path} fill={PALETTE.land} fillRule="evenodd" stroke={PALETTE.subdued} strokeWidth={0.18} />)}
      {!!footprintPaths.fill && <Path d={footprintPaths.fill} fill={PALETTE.accent} fillOpacity={0.16} />}
      {footprintPaths.outline.map((path, index) => <Path key={`footprint-${index}`} d={path} fill="none" stroke={PALETTE.accent} strokeWidth={0.6} />)}
      {trackPaths.map((path, index) => <Path key={`track-${index}`} d={path} fill="none" stroke={PALETTE.accent} strokeWidth={0.7} strokeDasharray="2 1" />)}
      {observer && <Marker latitude={observer.latitude} longitude={observer.longitude} color={PALETTE.subdued} radius={1.5} label="Ubicación del observador" />}
      {visibleSatellites.map(satellite => <Marker key={satellite.noradId} latitude={satellite.latitude} longitude={satellite.longitude} color={PALETTE.subdued} radius={1.1} label={`Satélite ${satellite.noradId}`} onPress={() => onSelectSatellite?.(satellite.noradId)} />)}
      {animatedPosition && <Marker latitude={animatedPosition.latitude} longitude={animatedPosition.longitude} color={PALETTE.accent} radius={2.2} label="Posición del satélite" />}
    </Svg>
    {showConstellation && constellation.length > MAX_CONSTELLATION_MARKERS && <Text style={styles.note}>Se muestran {MAX_CONSTELLATION_MARKERS} de {constellation.length} satélites.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: PALETTE.background, borderRadius: 16, padding: 10, gap: 8 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  layerButton: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', backgroundColor: PALETTE.ocean, borderWidth: 1, borderColor: PALETTE.subdued },
  layerButtonSelected: { borderColor: PALETTE.accent },
  layerText: { color: PALETTE.subdued, fontSize: 12, fontWeight: '600' },
  layerTextSelected: { color: PALETTE.accent },
  zoomControls: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  zoomButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: PALETTE.ocean, borderWidth: 1, borderColor: PALETTE.subdued },
  disabledButton: { opacity: 0.45 },
  zoomText: { color: PALETTE.land, fontSize: 22, lineHeight: 26, fontWeight: '600' },
  note: { color: PALETTE.subdued, fontSize: 12 },
});
