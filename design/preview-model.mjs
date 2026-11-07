// Isolated design-preview behavior. Never imported by the native app.
export function searchCatalog(rows, query, group = 'all') {
  const term = query.trim().toLocaleLowerCase('en');
  return rows.filter(row => (group === 'all' || row.group === group)
    && (row.name.toLocaleLowerCase('en').includes(term) || String(row.id).includes(term)));
}
export function toggleReminder(ids, id) {
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}

// Deliberately illustrative values: these are not propagated orbital elements.
export const satellites = [
  { id: 25544, name: 'ISS (ZARYA)', short: 'ISS', subtitle: 'Estación Espacial Internacional', group: 'stations', type: 'Estación tripulada', altitude: '418,6', speed: '7,66', period: '92,9', inclination: '51,64', latitude: '24,8° S', longitude: '43,2° O', x: 380, y: 344 },
  { id: 20580, name: 'HUBBLE', short: 'Hubble', subtitle: 'Telescopio espacial Hubble', group: 'science', type: 'Telescopio espacial', altitude: '515,2', speed: '7,61', period: '95,2', inclination: '28,47', latitude: '18,0° N', longitude: '28,8° E', x: 580, y: 225 },
  { id: 44713, name: 'STARLINK-1007', short: 'Starlink', subtitle: 'Starlink-1007', group: 'constellations', type: 'Comunicaciones', altitude: '549,8', speed: '7,59', period: '95,6', inclination: '53,05', latitude: '39,6° N', longitude: '82,8° O', x: 270, y: 165 },
  { id: 48274, name: 'TIANGONG', short: 'Tiangong', subtitle: 'Estación espacial Tiangong', group: 'stations', type: 'Estación tripulada', altitude: '389,4', speed: '7,69', period: '92,0', inclination: '41,47', latitude: '7,2° S', longitude: '108,0° E', x: 800, y: 295 },
];
