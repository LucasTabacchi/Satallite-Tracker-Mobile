import { satellites, searchCatalog, toggleReminder } from './preview-model.mjs';
import { selectMapSatellite, activateMap } from './live-map-view.mjs';

const $ = selector => document.querySelector(selector);
const pages = ['track', 'sky', 'passes', 'catalog'];
const groupLabels = { stations: 'ESTACIONES', science: 'CIENCIA', constellations: 'CONSTELACIONES' };
let selectedId = 25544;
let group = 'all';
let reminders = [];
let toastTimer;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

function navigate() {
  const candidate = location.hash.slice(1);
  if (candidate === 'main') return;
  const page = pages.includes(candidate) ? candidate : 'track';
  activateMap(page === 'track');
  for (const id of pages) $(`#page-${id}`).hidden = id !== page;
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${page === 'catalog' ? 'Catálogo' : page === 'sky' ? 'Cielo' : page === 'passes' ? 'Pases' : 'Seguimiento'} · Prototipo de Orbit`;
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('#main').focus({ preventScroll: true });
}
window.addEventListener('hashchange', navigate);

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}

document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
  $(`#${button.dataset.open}-dialog`).showModal();
}));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

function selectSatellite(id) {
  const satellite = satellites.find(row => row.id === id);
  if (!satellite) return;
  selectedId = id;
  for (const [selector, value] of Object.entries({
    '#satellite-short': satellite.short, '#satellite-subtitle': satellite.subtitle,
    '#satellite-kind': satellite.type, '#satellite-norad': `NORAD ${id}`,
    '#marker-name': satellite.short.toUpperCase(),
    '#map-active': `${satellite.short.toUpperCase()} · ${id}`,
  })) $(selector).textContent = value;
  selectMapSatellite(id);
  renderCatalog();
  location.hash = 'track';
  toast(`Seguimiento de ${satellite.name}`);
}

function renderCatalog() {
  const state = $('#catalog-state').value;
  const list = $('#catalog-list');
  list.replaceChildren();
  list.setAttribute('aria-busy', String(state === 'loading'));
  if (state === 'loading') {
    $('#catalog-status').textContent = 'Demostración: cargando el catálogo orbital. Elige Disponible para salir de este estado de prueba.';
    list.innerHTML = '<div class="skeleton" aria-hidden="true"></div><div class="skeleton" aria-hidden="true"></div>';
    return;
  }
  if (state === 'error') {
    $('#catalog-status').textContent = 'Demostración: no se pudo acceder al proveedor orbital.';
    list.innerHTML = '<div class="empty-state"><span class="eyebrow">PROVEEDOR NO DISPONIBLE</span><h2>Una breve pérdida de señal.</h2><p>Intenta nuevamente o utiliza los datos orbitales en caché cuando estén disponibles.</p><button id="retry-catalog">Reintentar demostración</button></div>';
    $('#retry-catalog').addEventListener('click', () => { $('#catalog-state').value = 'ready'; renderCatalog(); });
    return;
  }
  const matches = searchCatalog(satellites, $('#search').value, group);
  $('#catalog-status').textContent = state === 'offline'
    ? `Demostración: sin conexión · caché de ejemplo desactualizada (30 horas). ${matches.length} objetos.`
    : `${matches.length} ${matches.length === 1 ? 'objeto' : 'objetos'} en el catálogo de prueba`;
  if (!matches.length) {
    list.innerHTML = '<div class="empty-state"><span class="eyebrow">SIN RESULTADOS</span><h2>¿Buscamos un poco más allá?</h2><p>Prueba con otro nombre, ID NORAD o constelación.</p><button id="reset-search">Borrar búsqueda y filtros</button></div>';
    $('#reset-search').addEventListener('click', () => { $('#search').value = ''; setGroup('all'); $('#search').focus(); });
    return;
  }
  // Only fixed local fixture strings enter this template; user search is never inserted as HTML.
  for (const satellite of matches) {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    card.innerHTML = `<div class="catalog-card-top">${icon('satellite')}<span class="pill">${groupLabels[satellite.group]}</span></div><div><h2>${satellite.name}</h2><p>${satellite.subtitle}</p></div><div class="catalog-card-bottom"><span class="mono">NORAD ${satellite.id}</span><button aria-label="Seguir ${satellite.name}">${selectedId === satellite.id ? 'Siguiendo ↗' : 'Seguir ↗'}</button></div>`;
    card.querySelector('button').addEventListener('click', () => selectSatellite(satellite.id));
    list.append(card);
  }
}
function setGroup(value) {
  group = value;
  document.querySelectorAll('[data-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.group === group)));
  renderCatalog();
}
document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => setGroup(button.dataset.group)));
$('#search').addEventListener('input', renderCatalog);
$('#catalog-state').addEventListener('change', renderCatalog);

const passes = [
  { id: 'pass-1', start: '19:08', end: '19:14', elevation: 64, duration: '6m 12s', direction: 'SO → NE', label: 'ELEVACIÓN ALTA' },
  { id: 'pass-2', start: '20:45', end: '20:50', elevation: 32, duration: '5m 04s', direction: 'O → N', label: 'ELEVACIÓN MEDIA' },
  { id: 'pass-3', start: '22:22', end: '22:25', elevation: 12, duration: '3m 18s', direction: 'NO → N', label: 'ELEVACIÓN BAJA' },
];
for (const pass of passes) {
  const row = document.createElement('article');
  row.className = 'pass-item';
  row.innerHTML = `<div class="pass-item-top"><span class="pass-time">${pass.start}<small>— ${pass.end}</small></span><span class="pass-rating">${pass.elevation}° MÁX.</span></div><div class="pass-meta"><span>ISS (ZARYA)</span><span>${pass.duration}</span><span>${pass.label}</span></div><svg class="pass-arc" viewBox="0 0 420 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 52H420" stroke="#506045" stroke-dasharray="3 5"/><path d="M0 52Q210 ${52 - pass.elevation * 1.3} 420 52" fill="none" stroke="#b9d78e" stroke-width="1.5"/></svg><div class="pass-footer"><span class="pass-route">${pass.direction}</span><button class="reminder-toggle" aria-pressed="false" aria-label="Recordatorio de prueba para el pase de las ${pass.start}" data-reminder="${pass.id}">${icon('bell')}<span>Avisarme</span></button></div>`;
  row.querySelector('button').addEventListener('click', event => {
    reminders = toggleReminder(reminders, pass.id);
    const active = reminders.includes(pass.id);
    event.currentTarget.setAttribute('aria-pressed', String(active));
    event.currentTarget.innerHTML = `${icon(active ? 'check' : 'bell')}<span>${active ? 'Seleccionado' : 'Avisarme'}</span>`;
    updateReminderSummary();
    toast(active ? 'Recordatorio de prueba seleccionado. No se programó ninguna notificación.' : 'Recordatorio de prueba eliminado.');
  });
  $('#pass-list').append(row);
}
function updateReminderSummary() {
  $('#reminder-summary').textContent = reminders.length
    ? `${reminders.length} ${reminders.length === 1 ? 'recordatorio' : 'recordatorios'} de prueba · ${$('#lead-time').value} minutos antes de cada pase.`
    : 'No hay recordatorios de prueba seleccionados.';
}
$('#lead-time').addEventListener('change', updateReminderSummary);
renderCatalog();
navigate();
