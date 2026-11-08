'use strict';
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
  publicPath: 'cat://app/ruffle/',
  polyfills: false,
  autoplay: 'on',
  unmuteOverlay: 'hidden',
  splashScreen: false,
  wmode: 'transparent',
  backgroundColor: null,
  letterbox: 'off',
  scale: 'showAll',
  quality: 'high',
  contextMenu: 'rightClickOnly',
  showSwfDownload: false,
  warnOnUnsupportedContent: false,
  openUrlMode: 'allow',
  allowScriptAccess: true, // иначе fscommand не доходит до JS
  allowNetworking: 'all',
  logLevel: 'warn',
  // Текст фраз набран системным шрифтом «Arial CYR» — подставляем Arial из Windows.
  fontSources: ['cat://app/fonts/arial.ttf', 'cat://app/fonts/arialbd.ttf', 'cat://app/fonts/ariali.ttf', 'cat://app/fonts/arialbi.ttf'],
  defaultFonts: { sans: ['Arial'], serif: ['Arial'], typewriter: ['Arial'] },
};
