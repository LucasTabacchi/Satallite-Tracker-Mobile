import { useMemo, useRef, useState, type ElementRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateFootprint } from '@/geometry';
import { visibleCatalog } from '@/application/controller';
import type { ConstellationGroup } from '@/providers/types';
import { OrbitMap } from '@/ui/orbit-map';
import { CompassPanel, ObserverForm, PassesPanel, SkyPanel, ValidationPanel } from '@/ui/observation-panels';
import { useOrbit } from '@/ui/use-orbit';

const tabs = ['Seguimiento', 'Cielo', 'Pases', 'Catálogo', 'Ajustes'] as const;
type Tab = typeof tabs[number];
const groups: Array<[ConstellationGroup, string]> = [['stations', 'Estaciones'], ['starlink', 'Starlink'], ['gps-ops', 'GPS'], ['weather', 'Meteorológicos'], ['active', 'Todos activos']];
const proxyUrl = process.env.EXPO_PUBLIC_PROVIDER_PROXY_URL;
const number = (value: number | undefined, digits = 1) => value === undefined ? '—' : value.toLocaleString('es-AR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

function Button({ label, onPress, selected = false, disabled = false }: { label: string; onPress(): void; selected?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, selected && styles.selected, disabled && { opacity: 0.45 }]}>
    <Text style={[styles.buttonText, selected && { color: '#1b2817' }]}>{label}</Text>
  </Pressable>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text selectable style={styles.metricValue}>{value}</Text></View>;
}

export default function Tracker() {
  const app = useOrbit(proxyUrl);
  const { state, run } = app;
  const [tab, setTab] = useState<Tab>('Seguimiento');
  const [catalogLimit, setCatalogLimit] = useState(60);
  const scroll = useRef<ElementRef<typeof ScrollView>>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const selected = state?.catalog.find(row => row.NORAD_CAT_ID === state.selectedNoradId);
  const rows = useMemo(() => state ? visibleCatalog(state) : [], [state?.catalog, state?.query]);
  const footprint = useMemo(() => {
    const position = state?.position;
    return position && position.altitudeKm >= 0 ? calculateFootprint(position.altitudeKm, state.minimumElevationDeg, position.latitude, position.longitude) : undefined;
  }, [state?.position, state?.minimumElevationDeg]);
  const navigate = (next: Tab) => {
    if (next !== 'Cielo') app.stopHeading();
    setTab(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const epochHours = selected ? (Date.now() - Date.parse(selected.EPOCH)) / 3_600_000 : undefined;
  const observerValues = state?.observer ? { latitude: String(state.observer.latitude), longitude: String(state.observer.longitude), altitudeMeters: String(state.observer.altitudeKm * 1000) } : undefined;
  const pass = state?.passes?.windows[0] ?? null;
  const observerNotice = !state?.observer && <View style={styles.panel}>
    <Text style={styles.body}>Configure su ubicación para calcular direcciones y próximos pases.</Text>
    <Button label="Configurar ubicación" onPress={() => navigate('Ajustes')} />
  </View>;

  return <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={styles.page} contentContainerStyle={{ padding: width < 500 ? 16 : 28, paddingBottom: insets.bottom + 28, gap: 20, width: '100%', maxWidth: 1280, alignSelf: 'center' }}>
    <View style={styles.heading}>
      <View style={{ flex: 1 }}><Text style={styles.eyebrow}>ORBIT · EXPLORADOR SATELITAL</Text><Text accessibilityRole="header" style={styles.title}>{tab}</Text></View>
      <View style={styles.badge}><Text style={styles.badgeText}>{state?.active ? 'SGP4 · LOCAL' : 'EN PAUSA'}</Text></View>
    </View>
    <View style={styles.navigation}>{tabs.map(item => <Button key={item} label={item} selected={tab === item} onPress={() => navigate(item)} />)}</View>
    {!state?.initialized && <View style={styles.row}><ActivityIndicator color="#d1f5a2" /><Text style={styles.muted}>Cargando catálogo real…</Text></View>}
    {!!(app.actionError || state?.error) && <Text selectable accessibilityRole="alert" style={styles.error}>{app.actionError || 'No se pudo actualizar: ' + state?.error}</Text>}
    {!!state?.catalogWarning && <Text selectable style={styles.error}>Aviso de datos: {state.catalogWarning}</Text>}

    {tab === 'Seguimiento' && <>
      <View style={[styles.tracking, width >= 950 && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={{ flex: 2, minWidth: 0, gap: 12 }}>
          <OrbitMap position={state?.position} groundTrack={state?.groundTrack} footprint={footprint} observer={state?.observer}
            constellation={state?.constellationEnabled ? state.constellation?.positions : undefined} onSelectSatellite={id => run(app => app.selectSatellite(id))} />
          <Text style={styles.muted}>Cartografía Natural Earth · Cálculo local cada 2 s · No es telemetría medida</Text>
          <Button label={state?.constellationEnabled ? 'Ocultar constelación' : 'Mostrar constelación · máx. 50'} disabled={!state?.catalog.length}
            onPress={() => run(app => app.setConstellationEnabled(!state?.constellationEnabled, 50))} />
        </View>
        <View style={[styles.panel, { flex: 1, minWidth: 0 }]}>
          <Text style={styles.eyebrow}>SATÉLITE SELECCIONADO</Text>
          <Text selectable style={styles.satelliteName}>{selected?.OBJECT_NAME ?? 'Seleccione un satélite'}</Text>
          <Text style={styles.muted}>{state?.selectedNoradId ? 'NORAD ' + state.selectedNoradId : 'El catálogo utiliza datos orbitales reales.'}</Text>
          <View style={styles.metrics}>
            <Metric label="LATITUD" value={number(state?.position?.latitude, 4) + '°'} /><Metric label="LONGITUD" value={number(state?.position?.longitude, 4) + '°'} />
            <Metric label="ALTITUD" value={number(state?.position?.altitudeKm) + ' km'} /><Metric label="ELEVACIÓN" value={number(state?.position?.elevationDeg) + '°'} />
            <Metric label="AZIMUT" value={number(state?.position?.azimuthDeg) + '°'} /><Metric label="DISTANCIA" value={number(state?.position?.rangeKm) + ' km'} />
          </View>
          <Text style={styles.muted}>Fuente: {state?.catalogProvider ?? '—'} · {state?.catalogSource === 'network' ? 'descarga' : state?.catalogSource ? 'caché' : 'sin datos'}</Text>
          <Text style={epochHours !== undefined && (epochHours >= 24 || epochHours < 0) ? styles.error : styles.muted}>Antigüedad orbital: {number(epochHours)} h{epochHours !== undefined && epochHours < 0 ? ' · Época futura: revise datos y reloj' : epochHours !== undefined && epochHours >= 24 ? ' · Datos antiguos' : ''}</Text>
          <Text style={styles.muted}>Descarga: {state?.catalogFetchedAt ? new Date(state.catalogFetchedAt).toLocaleString('es-AR') : '—'}{state?.catalogStale ? ' · Sin actualización reciente' : ''}</Text>
          <Button label="Elegir satélite" onPress={() => navigate('Catálogo')} />
        </View>
      </View>
      {observerNotice}
      {state?.observer && <View style={styles.panel}>
        <Text style={styles.eyebrow}>PRÓXIMO PASE GEOMÉTRICO</Text>
        <Text style={styles.body}>{pass ? 'Máxima elevación ' + number(pass.maximum.elevationDeg) + '° · ' + pass.maximum.at.toLocaleString('es-AR') : 'Seleccione un satélite para consultar sus pases.'}</Text>
        <Button label="Ver próximos pases" onPress={() => navigate('Pases')} />
      </View>}
    </>}

    {tab === 'Catálogo' && <View style={styles.panel}>
      <Text style={styles.body}>Buscar en el grupo descargado</Text>
      <TextInput style={styles.input} accessibilityLabel="Buscar por nombre o NORAD" placeholder="Nombre o número NORAD" placeholderTextColor="#a4b0a2"
        value={state?.query ?? ''} onChangeText={query => { setCatalogLimit(60); run(app => app.setQuery(query)); }} />
      <View style={styles.row}>{groups.map(([group, label]) => <Button key={group} label={label} selected={state?.group === group}
        onPress={() => { setCatalogLimit(60); run(app => app.selectGroup(group)); }} />)}</View>
      <View style={styles.row}><Text style={styles.muted}>{rows.length} resultados · {state?.catalogProvider ?? 'sin fuente'}</Text>
        <Button label="Comprobar catálogo" onPress={() => run(app => app.refreshCatalog())} /></View>
      {state?.initialized && !rows.length && <Text style={styles.muted}>Sin resultados. Cambie el término o el grupo. Sin conexión, primero se necesita una descarga válida.</Text>}
      {rows.slice(0, catalogLimit).map(row => <Pressable key={row.NORAD_CAT_ID} accessibilityRole="button"
        accessibilityLabel={'Seleccionar ' + row.OBJECT_NAME + ', NORAD ' + row.NORAD_CAT_ID} style={styles.catalogRow}
        onPress={() => { run(app => app.selectSatellite(row.NORAD_CAT_ID)); navigate('Seguimiento'); }}>
        <View style={{ flex: 1 }}><Text style={styles.body}>{row.OBJECT_NAME}</Text>
          <Text style={styles.muted}>NORAD {row.NORAD_CAT_ID} · {number(Number(row.INCLINATION))}° de inclinación</Text></View><Text style={styles.accent}>↗</Text>
      </Pressable>)}
      {rows.length > catalogLimit && <Button label="Mostrar más satélites" onPress={() => setCatalogLimit(count => count + 60)} />}
    </View>}

    {tab === 'Cielo' && <>
      {observerNotice}
      <SkyPanel elements={selected ?? null} observer={state?.observer ?? null} pass={pass}
        loading={!!state?.observer && !!selected && !state.passes && !state.error} error={state?.error} />
      <CompassPanel status={!app.headingEnabled ? 'idle' : app.headingError ? 'unreliable' : (state?.position?.elevationDeg ?? -90) < 0 ? 'below-horizon' : 'active'}
        guidance={app.heading} error={app.headingError} onStart={() => void app.startHeading()} onStop={app.stopHeading} />
    </>}
    {tab === 'Pases' && <>
      {observerNotice}
      {!selected && <Text style={styles.muted}>Seleccione primero un satélite en el catálogo.</Text>}
      <Button label="Recalcular próximos pases" disabled={!selected || !state?.observer} onPress={() => run(app => app.refreshPasses())} />
      {selected && state?.observer && <PassesPanel passes={state.passes?.windows ?? []}
        status={state.error ? 'error' : !state.passes ? 'loading' : state.passes.windows.length ? 'ready' : 'empty'} error={state.error}
        leadMinutes={state.leadMinutes} onLeadMinutesChange={minutes => run(app => app.setLeadMinutes(minutes))} remindersEnabled={state.remindersEnabled}
        onReminderChange={enabled => run(app => enabled ? app.enableReminders() : app.disableReminders())}
        reminderStatus={state.reminderError ?? (state.remindersEnabled ? 'Recordatorios programados. Actualización del sistema: mejor esfuerzo.' : 'Sin confirmación de recordatorios en esta sesión.')} />}
      <Button label="Cancelar todos los recordatorios de Orbit" onPress={() => run(app => app.disableReminders())} />
    </>}
    {tab === 'Ajustes' && <>
      <ObserverForm key={JSON.stringify(observerValues)} initialValues={observerValues}
        onApply={observer => run(app => app.setObserver(observer))} onRequestGps={() => void app.requestGps()} gpsStatus={app.gpsStatus} />
      {state?.observer && <Button label="Borrar ubicación del observador" onPress={() => { app.stopHeading(); run(app => app.clearObserver()); }} />}
      <View style={styles.panel}><Text style={styles.body}>Elevación mínima del pase y la cobertura</Text>
        <View style={styles.row}>{[0, 5, 10, 20, 30].map(degrees => <Button key={degrees} label={degrees + '°'}
          selected={state?.minimumElevationDeg === degrees} onPress={() => run(app => app.setMinimumElevation(degrees))} />)}</View>
        <Text style={styles.muted}>Modelo de cobertura esférico. Sin relieve ni corrección atmosférica. La visibilidad geométrica no garantiza observación a simple vista.</Text>
      </View>
      <ValidationPanel row={state?.validationRows[0]} loading={state?.validationStatus === 'loading'} error={state?.validationError}
        whereTheIssAtAvailable={state?.selectedNoradId === 25544} n2yoAvailable={!!proxyUrl && !!selected}
        onValidateWhereTheIssAt={() => run(app => app.validateSelected('wheretheiss'))} onValidateN2yo={() => run(app => app.validateSelected('n2yo'))} />
      <Text style={styles.muted}>Los elementos orbitales se conservan 24 h y se actualizan respetando las cuotas de cada fuente. Las posiciones se calculan en el dispositivo.</Text>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101816' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 34, fontWeight: '600', color: '#eef0e5', letterSpacing: -1 },
  eyebrow: { color: '#a4b0a2', fontSize: 11, letterSpacing: 1.7 },
  badge: { backgroundColor: '#263521', padding: 10, borderRadius: 20 },
  badgeText: { color: '#d1f5a2', fontSize: 10, letterSpacing: 1 },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: '#202c24', alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: '#d1f5a2' },
  buttonText: { color: '#eef0e5', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  panel: { backgroundColor: '#19231e', borderRadius: 20, padding: 20, gap: 14 },
  body: { color: '#eef0e5', fontSize: 16, lineHeight: 23 },
  muted: { color: '#a4b0a2', fontSize: 12, lineHeight: 19 },
  error: { color: '#f3c08d', fontSize: 14, lineHeight: 21 },
  tracking: { gap: 20 },
  satelliteName: { color: '#eef0e5', fontSize: 25, fontWeight: '600' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metric: { flexBasis: 110, flexGrow: 1, gap: 4 },
  metricValue: { color: '#eef0e5', fontSize: 19, fontVariant: ['tabular-nums'] },
  input: { minHeight: 48, borderRadius: 14, backgroundColor: '#101816', color: '#eef0e5', padding: 14, fontSize: 16 },
  catalogRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#344238', gap: 10 },
  accent: { color: '#d1f5a2', fontSize: 24 },
});
