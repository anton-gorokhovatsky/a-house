const local = file => new URL(file, import.meta.url);
const sharedFonts = local('../../media/fonts/');
export const contestFontOrigin = 'https://static.tildacdn.com';

export const cabinetAssets = new Map([
  ['cabinet.css', { source: local('cabinet.css'), type: 'text/css; charset=utf-8' }],
  ['logo.svg', { source: local('logo.svg'), type: 'image/svg+xml' }],
  ...['roboto-flex-extended-regular.woff2', 'roboto-flex-compact-regular.woff2', 'robotoflex-OFL.txt'].map(name => [
    'fonts/' + name, { source: new URL(name, sharedFonts), type: name.endsWith('.woff2') ? 'font/woff2' : 'text/plain; charset=utf-8' }
  ])
]);
