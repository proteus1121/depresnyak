'use strict';

// Ссылки из ролика (getURL ... "_blank") открываем в системном браузере.
window.open = (url) => {
  window.__TAURI__.core.invoke('open_url', { url: String(url) });
  return null;
};

window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
  publicPath: 'ruffle/',
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
  // Текст фраз набран системным шрифтом «Arial CYR» — подставляем Arial из Windows
  // (его отдаёт хост по протоколу catfont, см. src-tauri/src/main.rs).
  fontSources: [
    'http://catfont.localhost/arial.ttf',
    'http://catfont.localhost/arialbd.ttf',
    'http://catfont.localhost/ariali.ttf',
    'http://catfont.localhost/arialbi.ttf',
  ],
  defaultFonts: { sans: ['Arial'], serif: ['Arial'], typewriter: ['Arial'] },
};
