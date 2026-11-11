/**
 * Ikon inline (stroke, 24×24, gaya Lucide). Tanpa file eksternal / tanpa
 * dependency — supaya dashboard tetap satu paket dengan bot.
 */
export type IconName =
  | 'home'
  | 'book'
  | 'tag'
  | 'brain'
  | 'sliders'
  | 'activity'
  | 'menu'
  | 'close'
  | 'search'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'check'
  | 'chevron'
  | 'logout'
  | 'sparkles'
  | 'message'
  | 'file'
  | 'users'
  | 'eye'
  | 'eye-off'
  | 'alert'
  | 'upload'
  | 'external'
  | 'shield'
  | 'mic'
  | 'cpu'
  | 'memory'
  | 'network'
  | 'disk';

const PATHS: Record<IconName, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z"/><path d="M4 17.5h16"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.5V4a2 2 0 0 1 2-2h7.9a2 2 0 0 1 1.5.6l6.4 6.4a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  brain: '<path d="M12 5a3 3 0 0 0-6 0v.4A3 3 0 0 0 4 8.3 3 3 0 0 0 5 14a3 3 0 0 0 3.5 4.6A2.5 2.5 0 0 0 12 20V5Z"/><path d="M12 5a3 3 0 0 1 6 0v.4A3 3 0 0 1 20 8.3 3 3 0 0 1 19 14a3 3 0 0 1-3.5 4.6A2.5 2.5 0 0 1 12 20V5Z"/>',
  sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/>',
  activity: '<path d="M3 12h3.5l2.5 6 3.5-14 2.5 8h5.5"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  sparkles: '<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8L12 3Z"/><path d="M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-3.8-.9L3 21l1.9-5.7A8.9 8.9 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 11a3 3 0 1 0-1.5-5.6"/><path d="M17.5 20a6 6 0 0 0-2-4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9"/><path d="M6.3 7.3A16.6 16.6 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  alert: '<path d="M12 3 2.6 19h18.8L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z"/><path d="m9.2 12.2 2 2 3.6-3.9"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
  memory: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3"/><path d="M12 17v3"/><path d="M18 17v3"/><path d="M7 11h2"/><path d="M12 11h2"/><path d="M17 11h1"/>',
  network: '<path d="M4 9 12 3l8 6"/><path d="M4 20 12 14l8 6"/><path d="M12 3v18"/>',
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
};

export function icon(name: IconName, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
