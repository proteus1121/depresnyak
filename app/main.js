// Кот Депресняк — хост-приложение на Electron.
// Воспроизводит оригинальный cat.swf через Ruffle в прозрачном окне поверх всех окон,
// как это делал MDM Zinc: левая кнопка мыши таскает кота, правая открывает его меню.
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, dialog, protocol, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const STAGE_W = 920;
const STAGE_H = 750;
const ABOUT_TITLE = 'Кот Депресняк';

app.setAppUserModelId('ru.buslaev.depresnyak');
// Звук без предварительного клика пользователя.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'cat', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------- настройки ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = { scale: 64, onTop: true, x: null, y: null, muted: false };
let settings = { ...defaults };
function loadSettings() {
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...defaults };
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('settings save failed', e);
  }
}

// ---------- раздача файлов по cat:// ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.swf': 'application/x-shockwave-flash',
  '.png': 'image/png',
  '.map': 'application/json',
};
const roots = {
  app: __dirname,
  ruffle: path.dirname(require.resolve('@ruffle-rs/ruffle/package.json')),
};
function registerProtocol() {
  protocol.handle('cat', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let root = url.host === 'app' ? roots.app : null;
    if (rel.startsWith('ruffle/')) {
      root = roots.ruffle;
      rel = rel.slice('ruffle/'.length);
    } else if (rel.startsWith('fonts/')) {
      // Ролик просит системный шрифт «Arial CYR»; отдаём Ruffle системный Arial из Windows.
      rel = rel.slice('fonts/'.length);
      if (!/^arial(bd|bi|i)?\.ttf$/i.test(rel)) return new Response('forbidden', { status: 403 });
      root = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
    }
    const file = root && path.normalize(path.join(root, rel));
    if (!file || !file.startsWith(root)) return new Response('forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------- окно ----------
let win = null;
let tray = null;
let quitting = false;

function windowSize() {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.round((wa.height * settings.scale) / 100);
  const w = Math.round((h * STAGE_W) / STAGE_H);
  return { w, h, wa };
}

function clampToScreen(x, y, w, h) {
  const d = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  // Разрешаем коту частично уходить за край, но не теряться совсем.
  const minVisible = 80;
  x = Math.min(Math.max(x, d.x - w + minVisible), d.x + d.width - minVisible);
  y = Math.min(Math.max(y, d.y - h + minVisible), d.y + d.height - minVisible);
  return { x, y };
}

function createWindow() {
  const { w, h, wa } = windowSize();
  let x = settings.x ?? Math.round(wa.x + (wa.width - w) / 2);
  let y = settings.y ?? Math.round(wa.y + (wa.height - h) / 2);
  ({ x, y } = clampToScreen(x, y, w, h));

  win = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.onTop,
    skipTaskbar: false,
    title: ABOUT_TITLE,
    icon: path.join(__dirname, 'assets', 'cat.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(settings.onTop, 'floating');
  win.setMenu(null);
  win.loadURL('cat://app/index.html');
  win.once('ready-to-show', () => win.showInactive());
  if (process.env.CAT_DEBUG) {
    win.webContents.on('console-message', (e) => console.log(`[page:${e.level}] ${e.message}`));
  }

  // Ссылки из ролика (getURL ... _blank) открываем в браузере.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('cat://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.on('moved', () => {
    const [px, py] = win.getPosition();
    settings.x = px;
    settings.y = py;
    saveSettings();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      updateTrayMenu();
    }
  });

  startClickThrough();
}

// ---------- клики сквозь прозрачные участки ----------
// Окно размером со сцену (920x750), а кот занимает только часть. Как и в Zinc,
// прозрачные пиксели должны пропускать мышь к окнам под котом.
let ignoring = false;
let dragging = false;
let probeBusy = false;
function setIgnore(v) {
  if (!win || ignoring === v) return;
  ignoring = v;
  win.setIgnoreMouseEvents(v, { forward: true });
}
function startClickThrough() {
  setInterval(async () => {
    if (!win || !win.isVisible() || dragging || probeBusy || menuOpen) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
      setIgnore(true);
      return;
    }
    probeBusy = true;
    try {
      const img = await win.webContents.capturePage({ x: p.x - b.x, y: p.y - b.y, width: 1, height: 1 });
      const bmp = img.toBitmap(); // BGRA
      const alpha = bmp.length >= 4 ? bmp[3] : 0;
      setIgnore(alpha < 16);
    } catch {
      // окно могло закрыться — не страшно
    } finally {
      probeBusy = false;
    }
  }, 50);
}

// Пока открыто HTML-меню Ruffle, клики должны доходить до окна.
let menuOpen = false;
ipcMain.on('menu-open', (_e, open) => {
  menuOpen = !!open;
  if (menuOpen) setIgnore(false);
});

// ---------- перетаскивание левой кнопкой ----------
let dragTimer = null;
ipcMain.on('drag-start', () => {
  if (!win) return;
  dragging = true;
  setIgnore(false);
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const off = { x: start.x - wx, y: start.y - wy };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    win.setPosition(p.x - off.x, p.y - off.y);
  }, 10);
});
ipcMain.on('drag-end', () => {
  dragging = false;
  clearInterval(dragTimer);
  dragTimer = null;
  if (win) {
    // setPosition не вызывает событие 'moved', поэтому сохраняем позицию здесь.
    [settings.x, settings.y] = win.getPosition();
    saveSettings();
  }
});

// ---------- команды из ролика (заглушка mdm.*) ----------
ipcMain.on('fscommand', (_e, cmd, arg) => {
  if (process.env.CAT_DEBUG) console.log('fscommand:', cmd, JSON.stringify(arg));
  if (process.env.CAT_SELFTEST && cmd !== 'minimizeToTray') return; // в самотесте не выходим и не прячемся
  switch (String(cmd).toLowerCase()) {
    case 'exit':
      quit();
      break;
    case 'minimize':
      if (win) win.hide(); // как minimizeToTray(true): прячемся в трей
      updateTrayMenu();
      break;
    case 'minimizetotray':
      break; // поведение уже такое: «Свернуть» прячет кота в трей
    case 'prompt':
      showAbout(arg);
      break;
    default:
      console.log('fscommand', cmd, arg);
  }
});
ipcMain.on('escape', () => quit()); // в Zinc Esc закрывал окно
ipcMain.handle('get-settings', () => ({ muted: settings.muted }));

const DEFAULT_ABOUT =
  'Помесь адского кота и райской кошечки из хулиганского фэнтази «Мефодий Буслаев». ' +
  'Биовампир, забияка, обладает кошмарным характером и чудовищным аппетитом.';
function showAbout(text) {
  const opts = {
    type: 'none',
    title: 'О программе',
    message: ABOUT_TITLE,
    detail:
      (text || DEFAULT_ABOUT) +
      '\n\nПорт оригинальной программы (MDM Zinc + Flash, 2006) на Electron и Ruffle. ' +
      'Анимация и звук — из оригинального cat.swf.',
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'cat48.png')),
    buttons: ['OK'],
  };
  if (win && win.isVisible()) dialog.showMessageBox(win, opts);
  else dialog.showMessageBox(opts);
}

// ---------- трей ----------
function showCat() {
  if (!win) return;
  win.showInactive();
  win.setAlwaysOnTop(settings.onTop, 'floating');
  updateTrayMenu();
}
function setScale(scale) {
  settings.scale = scale;
  saveSettings();
  if (!win) return;
  const { w, h } = windowSize();
  const b = win.getBounds();
  // масштабируем относительно центра
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const { x, y } = clampToScreen(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
  win.setBounds({ x, y, width: w, height: h });
  updateTrayMenu();
}
function resetPosition() {
  settings.x = settings.y = null;
  saveSettings();
  const { w, h, wa } = windowSize();
  win.setBounds({ x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h });
}
function autostartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}
function updateTrayMenu() {
  if (!tray) return;
  const visible = win && win.isVisible();
  const menu = Menu.buildFromTemplate([
    { label: visible ? 'Спрятать кота' : 'Показать кота', click: () => (visible ? win.hide() : showCat(), updateTrayMenu()) },
    { type: 'separator' },
    {
      label: 'Размер',
      submenu: [30, 40, 50, 64, 80, 100].map((s) => ({
        label: `${s}% высоты экрана${s === 64 ? ' (как в оригинале)' : ''}`,
        type: 'radio',
        checked: settings.scale === s,
        click: () => setScale(s),
      })),
    },
    {
      label: 'Поверх всех окон',
      type: 'checkbox',
      checked: settings.onTop,
      click: (item) => {
        settings.onTop = item.checked;
        saveSettings();
        win && win.setAlwaysOnTop(settings.onTop, 'floating');
      },
    },
    {
      label: 'Без звука',
      type: 'checkbox',
      checked: settings.muted,
      click: (item) => {
        settings.muted = item.checked;
        saveSettings();
        win && win.webContents.setAudioMuted(settings.muted);
      },
    },
    { label: 'Вернуть в центр экрана', click: resetPosition },
    {
      label: 'Запускать вместе с Windows',
      type: 'checkbox',
      checked: autostartEnabled(),
      enabled: app.isPackaged,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'О программе', click: () => showAbout() },
    { label: 'Выход', click: quit },
  ]);
  tray.setContextMenu(menu);
}
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'cat.ico'));
  tray.setToolTip(ABOUT_TITLE);
  tray.on('click', () => {
    if (win && win.isVisible()) win.hide();
    else showCat();
    updateTrayMenu();
  });
  updateTrayMenu();
}

function quit() {
  quitting = true;
  app.quit();
}

app.on('second-instance', () => showCat());

app.whenReady().then(() => {
  loadSettings();
  registerProtocol();
  createWindow();
  win.webContents.setAudioMuted(settings.muted);
  createTray();
  if (process.env.CAT_SELFTEST) require('./selftest')(win, process.env.CAT_SELFTEST);
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => app.quit());
