import { createBrowserLoader, createLiveMapController, projectCoordinate, OBSERVER } from './live-map.js';

const $ = selector => document.querySelector(selector);
const number = (value, digits = 1) => value.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
const date = value => new Date(value).toLocaleString('es-AR', { timeZone: 'UTC', hour12: false }) + ' UTC';
const age = ms => ms < 0 ? 'Época futura' : ms < 3600000 ? `${Math.floor(ms / 60000)} min` : `${number(ms / 3600000, 1)} h`;
const sourceNames = { celestrak: 'CelesTrak', wheretheiss: 'Where the ISS at?' };
let requestedActive = false, ready = false, showGround = true, showFootprint = true;

function showGeometry() {
  $('#satellite-marker').toggleAttribute('hidden', !ready);
  $('#ground-track').toggleAttribute('hidden', !ready || !showGround);
  $('#footprint').toggleAttribute('hidden', !ready || !showFootprint);
  $('.map-legend').hidden = !ready || !showGround;
}
function paths(points, close = false) {
  const rows = close ? [...points, points[0]] : points;
  let previous;
  return rows.map(row => {
    if (!row) return '';
    const point = projectCoordinate(row.latitude, row.longitude);
    const start = !previous || Math.abs(row.longitude - previous.longitude) > 180;
    previous = row;
    return `${start ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ');
}
function wrapPaths(content) {
  return [-1000, 0, 1000].map(offset => `<g transform="translate(${offset} 0)">${content}</g>`).join('');
}
function render(event) {
  ready = event.status === 'ready';
  showGeometry();
  $('#map-status').dataset.state = event.status;
  $('#map-retry').hidden = event.status !== 'error';
  if (!ready) {
    $('#map-status').textContent = event.status === 'loading'
      ? 'Consultando datos orbitales… El mapa aparecerá cuando se puedan calcular.'
      : 'No se pudo calcular la posición. Revisa la conexión o el proveedor; no se muestran posiciones de ejemplo.';
    for (const field of ['altitude', 'velocity', 'period', 'inclination', 'latitude', 'longitude']) $(`#${field}`).textContent = '—';
    $('#map-clock').textContent = 'ESPERANDO DATOS';
    $('#source-summary').textContent = 'Datos orbitales pendientes';
    $('#source-description').textContent = 'No hay datos orbitales válidos para el satélite seleccionado.';
    $('#source-details').replaceChildren();
    return;
  }
  const frame = event.frame;
  const stale = frame.source === 'stale-cache' || frame.epochAgeMs >= 86400000 || frame.epochAgeMs < 0;
  $('#map-status').textContent = `${stale ? 'Advertencia: datos orbitales antiguos o no renovados. ' : ''}Posición calculada con SGP4 cada 2 s. Época: ${age(frame.epochAgeMs)}.${frame.warning ? ' No se pudo renovar o guardar la caché.' : ''}`;
  $('#map-status').dataset.stale = String(stale);
  $('#map-clock').textContent = date(frame.at);
  $('#map-clock').dataset.at = frame.at;
  $('#satellite-marker').setAttribute('transform', `translate(${frame.point.x} ${frame.point.y})`);
  $('.world-map').style.setProperty('--map-focus', `${frame.point.x / 10}%`);
  $('#altitude').textContent = number(frame.position.altitudeKm);
  $('#velocity').textContent = number(frame.speedKmS, 2);
  $('#period').textContent = number(frame.periodMinutes);
  $('#inclination').textContent = number(frame.inclination, 2);
  $('#latitude').textContent = `${number(Math.abs(frame.position.latitude), 4)}° ${frame.position.latitude >= 0 ? 'N' : 'S'}`;
  $('#longitude').textContent = `${number(Math.abs(frame.position.longitude), 4)}° ${frame.position.longitude >= 0 ? 'E' : 'O'}`;
  const samples = frame.groundTrack.samples;
  const pivot = samples.findIndex(point => point.at.getTime() >= Date.parse(frame.at));
  const before = samples.slice(0, Math.max(1, pivot + 1));
  const after = samples.slice(Math.max(0, pivot));
  $('#ground-track').innerHTML = wrapPaths(`<path d="${paths(before)}" stroke-dasharray="5 8" opacity=".6"/><path d="${paths(after)}"/>`);
  $('#footprint').innerHTML = wrapPaths(`<path d="${paths(frame.footprint.coordinates, true)}" fill="none" stroke="#c8f294" stroke-opacity=".55" stroke-width="1.2"/>`);
  const provider = sourceNames[frame.provider] ?? frame.provider;
  $('#source-summary').textContent = `${provider} · época ${age(frame.epochAgeMs)}`;
  $('#source-description').textContent = 'La posición se calcula localmente a partir de elementos orbitales. No es una medición directa del satélite.';
  const details = {
    'Proveedor': provider, 'Época orbital': date(frame.epoch), 'Antigüedad orbital': age(frame.epochAgeMs),
    'Última descarga': date(frame.fetchedAt), 'Antigüedad de descarga': age(frame.fetchAgeMs),
    'Origen': frame.source === 'network' ? 'Red' : frame.source === 'cache' ? 'Caché local' : 'Caché sin renovar',
  };
  $('#source-details').replaceChildren(...Object.entries(details).map(([label, value]) => {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
  }));
}

const controller = createLiveMapController({
  load: createBrowserLoader({ async getItem(key) { return localStorage.getItem(key); }, async setItem(key, value) { localStorage.setItem(key, value); } }),
  emit: render,
});
export function selectMapSatellite(id) { ready = false; showGeometry(); controller.select(id); }
export function activateMap(active) {
  requestedActive = active;
  $('#scope-label').textContent = active ? 'Seguimiento orbital' : 'Prototipo de diseño';
  $('#scope-note').textContent = active ? 'SGP4 local · observador de ejemplo' : 'Datos ilustrativos · no en tiempo real';
  controller.setActive(active && !document.hidden);
}
for (const kind of ['track', 'footprint']) $(`#toggle-${kind}`).addEventListener('click', event => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  if (kind === 'track') showGround = enabled; else showFootprint = enabled;
  showGeometry();
});
$('#map-retry').addEventListener('click', () => controller.retry());
document.addEventListener('visibilitychange', () => controller.setActive(requestedActive && !document.hidden));
window.addEventListener('pagehide', event => { if (event.persisted) controller.setActive(false); else controller.dispose(); });
window.addEventListener('pageshow', () => controller.setActive(requestedActive && !document.hidden));
const observer = projectCoordinate(OBSERVER.latitude, OBSERVER.longitude);
$('#observer-marker').setAttribute('transform', `translate(${observer.x} ${observer.y})`);
