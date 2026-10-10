// icons.js — 線画の SVG アイコン。setIcon(btn, name) でボタンの先頭に入れる
const P = {
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  run: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/>',
  step: '<path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M18 5.5v13"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4.5" y="6.5" width="15" height="11" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M19.5 15.5c0 1.5-1 2.5-1.5 2.5s-1.5-1-1.5-2.5S18 13 18 13s1.5 1 1.5 2.5z" fill="currentColor"/>',
  select: '<rect x="4.5" y="4.5" width="15" height="15" stroke-dasharray="3 2.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  cut: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8.5 15L18 4M15.5 15L6 4"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2"/><path d="M9 11h6M9 15h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  cancel: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotcw: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v5h-5"/>',
  rotccw: '<path d="M4 12a8 8 0 102.3-5.7"/><path d="M4 4v5h5"/>',
  fliph: '<path d="M12 3v18"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>',
  flipv: '<path d="M3 12h18"/><path d="M7 9L17 4v5zM7 15l10 5v-5z"/>',
  filled: '<rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor"/>',
  hollow: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zsel: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path d="M8 10.5h5"/>',
};
export function setIcon(btn, name) {
  let s = btn.querySelector('svg.ic');
  if (!s) {
    s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    btn.prepend(s);
  }
  s.innerHTML = P[name] || '';
}
