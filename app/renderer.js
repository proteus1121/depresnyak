'use strict';
/* global RufflePlayer, host */

const ruffle = window.RufflePlayer.newest();
const player = ruffle.createPlayer();
document.getElementById('stage').appendChild(player);

// Вызовы mdm.Application.* / mdm.Dialogs.prompt из ролика приходят сюда
// через fscommand (см. tools/patch_swf.py).
const api = player.ruffle();
api.addFSCommandHandler((cmd, args) => {
  host.fscommand(cmd, args);
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
    /* разделитель прямо перед скрытым пунктом и висящий первым/последним */
    #context-menu li.menu-separator:has(+ li:is(${hidden.join(',')})) { display: none !important; }
    #context-menu li.menu-separator:has(+ li[data-text="Летать"]) { display: none !important; }
  `;
  root.appendChild(style);
}
hideRuffleMenuItems();
new MutationObserver(hideRuffleMenuItems).observe(player, { childList: true, subtree: true });

api.load({ url: 'cat://app/assets/cat.swf' }).catch((e) => console.error('load failed', e));

// ---- левая кнопка: таскаем окно (как leftmode="drag" в Zinc) ----
let dragging = false;
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || menuOpen) return;
  dragging = true;
  host.dragStart();
}, true);
const stopDrag = () => {
  if (!dragging) return;
  dragging = false;
  host.dragEnd();
};
window.addEventListener('pointerup', stopDrag, true);
window.addEventListener('blur', stopDrag);

// ---- правая кнопка: меню кота (Ruffle рисует его как HTML внутри окна) ----
let menuOpen = false;
function setMenu(open) {
  if (menuOpen === open) return;
  menuOpen = open;
  host.menuOpen(open);
}
window.addEventListener('contextmenu', () => setMenu(true), true);
window.addEventListener('pointerdown', (e) => {
  if (menuOpen && e.button === 0) setTimeout(() => setMenu(false), 150);
}, true);
// После выбора пункта Ruffle иногда оставляет меню на экране — закрываем сами.
window.addEventListener('click', () => {
  setTimeout(() => {
    const ul = player.shadowRoot && player.shadowRoot.getElementById('context-menu');
    if (ul && ul.parentElement) ul.parentElement.classList.add('hidden');
    setMenu(false);
  }, 50);
}, true);
window.addEventListener('blur', () => setMenu(false));

// ---- Esc закрывает программу (esccloseswindow="Yes") ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (menuOpen) setMenu(false);
    else host.escape();
  }
});
