import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { Elements, Observer } from '../orbit';
import type { PassWindow } from '../prediction';
import type { HeadingGuidance } from '../device';
import type { ValidationRow } from '../validation';
import { projectSkyPosition } from '../geometry';
import { createSkyTrack, formatLocalDateTime, parseObserverForm, type ObserverFormValues } from './observation-model';

const palette = { canvas: '#101816', panel: '#19231e', raised: '#202c24', text: '#eef0e5', muted: '#a4b0a2', accent: '#d1f5a2', line: '#344238', warning: '#f3c08d' };
const ui = StyleSheet.create({
  panel: { backgroundColor: palette.panel, borderRadius: 20, padding: 16, gap: 14, minWidth: 0, width: '100%' },
  title: { color: palette.text, fontSize: 20, fontWeight: '700' },
  body: { color: palette.text, fontSize: 15, lineHeight: 22 },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  error: { color: palette.warning, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: palette.raised, justifyContent: 'center', alignItems: 'center' },
  buttonSelected: { backgroundColor: palette.accent },
  buttonText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  buttonTextSelected: { color: '#1b2817' },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas, paddingHorizontal: 12, color: palette.text, fontSize: 16, flexGrow: 1, flexBasis: 120 },
  card: { backgroundColor: palette.raised, borderRadius: 12, padding: 12, gap: 5 },
  chart: { alignSelf: 'center', width: '100%', maxWidth: 340, aspectRatio: 1 },
  disabled: { opacity: 0.5 },
});

function ActionButton({ label, onPress, selected = false, disabled = false, accessibilityHint }: { label: string; onPress?: () => void; selected?: boolean; disabled?: boolean; accessibilityHint?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ selected, disabled }} disabled={disabled || !onPress} onPress={onPress} style={[ui.button, selected && ui.buttonSelected, (disabled || !onPress) && ui.disabled]}>
    <Text style={[ui.buttonText, selected && ui.buttonTextSelected]}>{label}</Text>
  </Pressable>;
}

export type SkyPanelProps = { elements: Elements | null; observer: Observer | null; pass: PassWindow | null; loading?: boolean; error?: string | null };
export function SkyPanel({ elements, observer, pass, loading = false, error }: SkyPanelProps) {
  const track = useMemo(() => elements && observer && pass ? createSkyTrack(elements, observer, pass) : [], [elements, observer, pass]);
  const path = track.reduce((segments, point) => {
    if (!point.visible) return [...segments, ''];
    const command = `${segments.at(-1) ? 'L' : 'M'} ${(170 + point.x * 142).toFixed(1)} ${(170 + point.y * 142).toFixed(1)}`;
    segments[segments.length - 1] = `${segments.at(-1) ?? ''} ${command}`;
    return segments;
  }, [''] as string[]).filter(Boolean).join(' ');
  const maximum = pass ? projectSkyPosition(pass.maximum.azimuthDeg, Math.max(0, Math.min(90, pass.maximum.elevationDeg))) : null;
  return <View style={ui.panel} accessibilityLabel="Carta celeste">
    <Text style={ui.title}>Cielo</Text>
    <Text style={ui.muted}>Visibilidad geométrica/radio; no indica visibilidad óptica a simple vista.</Text>
    {loading && <ActivityIndicator color={palette.accent} accessibilityLabel="Calculando trayectoria" />}
    {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    {!loading && !error && (!elements || !observer || !pass) && <Text style={ui.muted}>Elegí un satélite, una ubicación y un pase para calcular la trayectoria.</Text>}
    {!!pass && !!elements && !!observer && !loading && !error && <Svg viewBox="0 0 340 340" style={ui.chart} accessibilityRole="image" accessibilityLabel="Carta polar norte arriba; el centro representa el cenit">
      {[47, 94, 142].map((radius, index) => <Circle key={radius} cx="170" cy="170" r={radius} stroke={palette.line} strokeWidth="1" fill="none" />)}
      <Line x1="170" y1="28" x2="170" y2="312" stroke={palette.line} />
      <Line x1="28" y1="170" x2="312" y2="170" stroke={palette.line} />
      <SvgText x="170" y="18" fill={palette.text} fontSize="13" textAnchor="middle">N</SvgText>
      <SvgText x="322" y="175" fill={palette.text} fontSize="13" textAnchor="middle">E</SvgText>
      <SvgText x="170" y="333" fill={palette.text} fontSize="13" textAnchor="middle">S</SvgText>
      <SvgText x="18" y="175" fill={palette.text} fontSize="13" textAnchor="middle">O</SvgText>
      {[60, 30, 0].map((elevation, index) => <SvgText key={elevation} x="175" y={129 + index * 47} fill={palette.muted} fontSize="9">{elevation}°</SvgText>)}
      {!!path && <Path d={path} stroke={palette.accent} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {maximum && <Circle cx={170 + maximum.x * 142} cy={170 + maximum.y * 142} r="5" fill={palette.accent} stroke={palette.canvas} strokeWidth="2" />}
    </Svg>}
    {pass && <View style={ui.card}><Text style={ui.body}>Máxima elevación: {pass.maximum.elevationDeg.toFixed(1)}°</Text><Text style={ui.muted}>AOS {pass.aos ? formatLocalDateTime(pass.aos.at) : 'ya sobre el horizonte'} · LOS {pass.los ? formatLocalDateTime(pass.los.at) : 'fuera del intervalo'}</Text></View>}
  </View>;
}

export type PassesPanelProps = {
  passes: PassWindow[]; status: 'loading' | 'ready' | 'empty' | 'error'; error?: string | null;
  leadMinutes: number; onLeadMinutesChange: (minutes: number) => void; remindersEnabled: boolean;
  onReminderChange: (enabled: boolean, leadMinutes: number, pass: PassWindow | null) => void;
  reminderStatus?: string | null;
};
export function PassesPanel({ passes, status, error, leadMinutes, onLeadMinutesChange, remindersEnabled, onReminderChange, reminderStatus }: PassesPanelProps) {
  const pass = passes[0] ?? null;
  return <View style={ui.panel}>
    <Text style={ui.title}>Próximos pases</Text>
    <Text style={ui.muted}>Ventanas geométricas/radio para las próximas 48 horas; no equivalen a visibilidad óptica.</Text>
    {status === 'loading' && <View style={ui.row}><ActivityIndicator color={palette.accent} /><Text style={ui.body}>Calculando pases…</Text></View>}
    {status === 'error' && <Text accessibilityRole="alert" style={ui.error}>{error || 'No se pudieron calcular los pases.'}</Text>}
    {status === 'empty' && <Text style={ui.muted}>No hay pases dentro de las próximas 48 horas.</Text>}
    {status === 'ready' && passes.length === 0 && <Text style={ui.muted}>No hay pases disponibles.</Text>}
    {status === 'ready' && passes.map((item, index) => <View key={`${item.aos?.at.toISOString() ?? 'visible'}-${index}`} style={ui.card}>
      <Text style={ui.body}>AOS · {item.aos ? formatLocalDateTime(item.aos.at) : 'ya sobre el horizonte'}</Text>
      <Text style={ui.muted}>Máxima · {formatLocalDateTime(item.maximum.at)} · {item.maximum.elevationDeg.toFixed(1)}°</Text>
      <Text style={ui.muted}>LOS · {item.los ? formatLocalDateTime(item.los.at) : 'fuera del intervalo'}</Text>
    </View>)}
    <Text style={ui.body}>Recordar los próximos pases del satélite</Text>
    <Text style={ui.muted}>Se programan los pases futuros de las próximas 48 horas. La actualización en segundo plano depende del sistema operativo.</Text>
    <View style={ui.row}>{[5, 10, 15].map(value => <ActionButton key={value} label={`${value} min`} selected={leadMinutes === value} onPress={() => onLeadMinutesChange(value)} />)}</View>
    <View style={ui.row}><ActionButton label={remindersEnabled ? 'Desactivar aviso' : 'Activar aviso'} selected={remindersEnabled} onPress={() => onReminderChange(!remindersEnabled, leadMinutes, pass)} accessibilityHint="Guarda el aviso mediante la integración de notificaciones del dispositivo" /></View>
    {!!reminderStatus && <Text accessibilityLiveRegion="polite" style={ui.muted}>{reminderStatus}</Text>}
  </View>;
}

export type CompassPanelProps = { status: 'idle' | 'active' | 'unsupported' | 'unreliable' | 'below-horizon'; guidance?: HeadingGuidance | null; onStart: () => void; onStop: () => void; error?: string | null };
export function CompassPanel({ status, guidance, onStart, onStop, error }: CompassPanelProps) {
  const message = status === 'unsupported' ? 'Este dispositivo no ofrece un rumbo compatible.' : status === 'unreliable' ? 'Rumbo no fiable. Evite fuentes magnéticas e intente de nuevo.' : status === 'below-horizon' ? 'El satélite está bajo el horizonte geométrico.' : status === 'idle' ? 'Active la brújula para recibir orientación del dispositivo.' : 'Oriente el dispositivo hacia el objetivo indicado.';
  return <View style={ui.panel}>
    <Text style={ui.title}>Brújula</Text>
    <Text style={ui.body}>{message}</Text>
    {status === 'active' && guidance && <View style={ui.card}><Text style={ui.body}>Gire {Math.abs(guidance.turnDegrees).toFixed(0)}° {guidance.turnDegrees < 0 ? 'a la izquierda' : 'a la derecha'}</Text><Text style={ui.muted}>Elevación objetivo {guidance.targetElevationDeg.toFixed(1)}°</Text></View>}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    {['active', 'below-horizon', 'unreliable'].includes(status) ? <ActionButton label="Detener brújula" onPress={onStop} /> : <ActionButton label="Iniciar brújula" onPress={onStart} disabled={status === 'unsupported'} />}
  </View>;
}

export type ObserverFormProps = { initialValues?: ObserverFormValues; onApply: (observer: Observer) => void; onRequestGps: () => void; gpsStatus?: string | null };
export function ObserverForm({ initialValues = { latitude: '', longitude: '', altitudeMeters: '' }, onApply, onRequestGps, gpsStatus }: ObserverFormProps) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof ObserverFormValues, value: string) => setValues(current => ({ ...current, [key]: value }));
  const submit = () => { try { const observer = parseObserverForm(values); setError(null); onApply(observer); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Coordenadas inválidas.'); } };
  return <View style={ui.panel}>
    <Text style={ui.title}>Ubicación del observador</Text>
    <Text style={ui.muted}>Coordenadas manuales en grados decimales y altitud en metros.</Text>
    <View style={ui.row}>{([['latitude', 'Latitud'], ['longitude', 'Longitud'], ['altitudeMeters', 'Altitud (m)']] as const).map(([key, label]) => <TextInput key={key} value={values[key]} onChangeText={value => update(key, value)} keyboardType="numbers-and-punctuation" accessibilityLabel={label} placeholder={label} placeholderTextColor={palette.muted} style={ui.input} />)}</View>
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    <View style={ui.row}><ActionButton label="Aplicar ubicación" onPress={submit} /><ActionButton label="Usar GPS actual" onPress={onRequestGps} accessibilityHint="Solicita ubicación solo después de tocar este botón" /></View>
    {!!gpsStatus && <Text accessibilityLiveRegion="polite" style={ui.muted}>{gpsStatus}</Text>}
  </View>;
}

export type ValidationPanelProps = { row?: ValidationRow | null; loading?: boolean; error?: string | null; whereTheIssAtAvailable: boolean; n2yoAvailable: boolean; onValidateWhereTheIssAt?: () => void; onValidateN2yo?: () => void };
export function ValidationPanel({ row, loading = false, error, whereTheIssAtAvailable, n2yoAvailable, onValidateWhereTheIssAt, onValidateN2yo }: ValidationPanelProps) {
  return <View style={ui.panel}>
    <Text style={ui.title}>Validación independiente</Text>
    <Text style={ui.muted}>La comparación necesita una referencia externa alineada en satélite y hora; no es telemetría en vivo.</Text>
    <View style={ui.row}>
      <ActionButton label="Validar con Where the ISS at?" disabled={!whereTheIssAtAvailable || !onValidateWhereTheIssAt || loading} onPress={onValidateWhereTheIssAt} />
      <ActionButton label="Validar con N2YO" disabled={!n2yoAvailable || !onValidateN2yo || loading} onPress={onValidateN2yo} accessibilityHint={n2yoAvailable ? 'Usa un proxy configurado; no ingreses credenciales aquí' : 'No hay un proxy de N2YO configurado'} />
    </View>
    {!n2yoAvailable && <Text style={ui.muted}>N2YO no está configurado. La app no guarda ni solicita credenciales.</Text>}
    {!whereTheIssAtAvailable && <Text style={ui.muted}>Where the ISS at? solo está disponible para la ISS.</Text>}
    {loading && <ActivityIndicator color={palette.accent} accessibilityLabel="Consultando referencia" />}
    {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    {row && <ScrollView horizontal accessibilityLabel="Resultado de validación"><View style={ui.card}>
      <Text style={ui.body}>{row.provider} · NORAD {row.noradId} · error {row.errorKm.toFixed(2)} km</Text>
      <Text style={ui.muted}>Comparación {formatLocalDateTime(new Date(row.timestamp))}</Text>
      <Text style={ui.muted}>Época orbital {formatLocalDateTime(new Date(row.orbitalEpoch))} · antigüedad {Math.max(0, row.orbitalAgeMs / 3_600_000).toFixed(1)} h</Text>
      <Text style={ui.muted}>Referencia: {row.reference.latitude.toFixed(3)}°, {row.reference.longitude.toFixed(3)}°, {row.reference.altitudeKm.toFixed(1)} km</Text>
    </View></ScrollView>}
  </View>;
}
