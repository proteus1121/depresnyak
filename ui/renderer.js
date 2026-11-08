'use strict';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const ruffle = window.RufflePlayer.newest();
const player = ruffle.createPlayer();
document.getElementById('stage').appendChild(player);
const api = player.ruffle();

// Вызовы mdm.Application.* / mdm.Dialogs.prompt из ролика приходят сюда
// через fscommand (см. tools/patch_swf.py).
api.addFSCommandHandler((cmd, args) => {
  invoke('fscommand', { cmd: String(cmd), arg: args == null ? '' : String(args) });
  return true;
});

// В меню по правому клику оставляем только пункты самого кота,
// встроенные пункты Ruffle (качество, полный экран, громкость, отладка, «О Ruffle») прячем.
function hideRuffleMenuItems() {
  const root = player.shadowRoot;
  if (!root || root.getElementById('cat-menu-style')) return;
  const hidden = [
    '[data-text^="Quality"]',
    '[data-text^="Качество"]',
    '[data-text="Полноэкранный режим"]',
    '[data-text="Оконный режим"]',
    '[data-text="Громкость"]',
    '[data-text^="Копировать отладочную"]',
    '[data-text^="О Ruffle"]',
    '[data-text^="Скачать"]',
    '[data-text^="Менеджер сохранений"]',
    '[data-text^="Скрыть это меню"]',
  ];
  const style = document.createElement('style');
  style.id = 'cat-menu-style';
  style.textContent = `
    #context-menu li:is(${hidden.join(',')}) { display: none !important; }
    /* разделитель прямо перед скрытым пунктом и висящий первым */
    #context-menu li.menu-separator:has(+ li:is(${hidden.join(',')})) { display: none !important; }
    #context-menu li.menu-separator:has(+ li[data-text="Летать"]) { display: none !important; }
  `;
  root.appendChild(style);
}
hideRuffleMenuItems();

api.load({ url: 'assets/cat.swf' }).catch((e) => console.error('load failed', e));

// ---- звук ----
const setMuted = (m) => {
  try {
    api.volume = m ? 0 : 1;
  } catch (e) {
    console.warn(e);
  }
};
invoke('get_settings').then((s) => setMuted(s.muted));
listen('muted', (e) => setMuted(!!e.payload));

// ---- правая кнопка: меню кота (Ruffle рисует его как HTML внутри окна) ----
let menuOpen = false;
window.addEventListener('contextmenu', () => {
  menuOpen = true;
  setIgnore(false);
}, true);
const closeMenuSoon = () =>
  setTimeout(() => {
    // после выбора пункта Ruffle иногда оставляет меню на экране — закрываем сами
    const ul = player.shadowRoot && player.shadowRoot.getElementById('context-menu');
    if (ul && ul.parentElement) ul.parentElement.classList.add('hidden');
    menuOpen = false;
  }, 50);
window.addEventListener('click', closeMenuSoon, true);
window.addEventListener('blur', () => {
  menuOpen = false;
});

// ---- левая кнопка: таскаем окно (как leftmode="drag" в Zinc) ----
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || menuOpen) return;
  appWindow.startDragging().catch(() => {});
}, true);

// ---- Esc закрывает программу (esccloseswindow="Yes") ----
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuOpen) closeMenuSoon();
  else invoke('exit_app');
});

// ---- клики сквозь прозрачные места ----
// Окно размером со сцену 920x750, а кот занимает лишь часть. Как в Zinc, пустые места
// должны пропускать мышь к окнам под котом.
let ignoring = null;
function setIgnore(v) {
  if (ignoring === v) return;
  ignoring = v;
  appWindow.setIgnoreCursorEvents(v).catch(() => {});
}

// Есть ли под точкой (CSS-пиксели окна) нарисованный кот. Спрашиваем сам ролик:
// patch_swf.py добавляет ExternalInterface-колбэк catHit(x, y) = _root.hitTest(x, y, true).
// Сцена 920x750 вписана в окно с сохранением пропорций (scale: showAll).
const STAGE_W = 920;
const STAGE_H = 750;
function hitAt(x, y) {
  if (typeof player.catHit !== 'function') return true; // ролик ещё не готов — клики ловим
  const k = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
  const sx = (x - (innerWidth - STAGE_W * k) / 2) / k;
  const sy = (y - (innerHeight - STAGE_H * k) / 2) / k;
  if (sx < 0 || sy < 0 || sx >= STAGE_W || sy >= STAGE_H) return false;
  try {
    return !!player.catHit(sx, sy);
  } catch (e) {
    return true;
  }
}

let probing = false;
setInterval(async () => {
  if (probing) return;
  if (menuOpen) {
    setIgnore(false);
    return;
  }
  probing = true;
  try {
    const p = await invoke('cursor_in_window');
    if (!p) setIgnore(true);
    else setIgnore(!hitAt(p[0], p[1]));
  } catch (e) {
    // окно могло скрыться — не страшно
  } finally {
    probing = false;
  }
}, 50);
