'use strict';
// Самотест без реальной мыши. Включается переменной окружения CAT_SELFTEST=<пункт меню>,
// лог пишется в файл из CAT_SELFTEST_LOG. В обычном запуске ничего не делает.
(async () => {
  const { invoke } = window.__TAURI__.core;
  const item = await invoke('selftest_config');
  if (!item) return;
  const log = (...a) => invoke('selftest_log', { msg: a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.addEventListener('error', (e) => log('ERROR', e.message));
  for (const lvl of ['error', 'warn', 'info', 'log']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => {
      log(`[${lvl}]`, a.map((x) => String(x && x.stack ? x.stack : x)).join(' ').slice(0, 400));
      orig(...a);
    };
  }
  try {
    await sleep(5000);
    const root = player.shadowRoot;
    log('catHit available', typeof player.catHit);
    const ac = new AudioContext();
    log('test AudioContext state', ac.state); // running = автовоспроизведение звука не заблокировано
    ac.close();
    log('hit corner', hitAt(2, 2), 'center', hitAt(innerWidth / 2, innerHeight / 2));
    // ищем точку на коте; заодно считаем, какая доля окна «кликабельна»
    let pt = null;
    let hits = 0;
    let total = 0;
    for (let y = 0; y < innerHeight; y += 10)
      for (let x = 0; x < innerWidth; x += 10) {
        total++;
        if (hitAt(x, y)) {
          hits++;
          if (!pt) pt = [x, y];
        }
      }
    log('cat point', pt, 'hit share', (hits / total).toFixed(3));
    if (!pt) return;
    const opts = { bubbles: true, composed: true, cancelable: true, clientX: pt[0], clientY: pt[1], button: 2, buttons: 2 };
    const target = root.elementFromPoint(pt[0], pt[1]) || player;
    target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('contextmenu', opts));
    await sleep(1500);
    const items = [...root.querySelectorAll('#context-menu li.menu-item')];
    log('menu', items.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim()));
    const el = items.find((e) => e.textContent.trim() === item);
    log('click', item, !!el);
    if (el) el.click();
    await sleep(1000);
    log('menu hidden after click', !root.getElementById('context-menu') || root.getElementById('context-menu').parentElement.classList.contains('hidden'));
  } catch (e) {
    log('EXC', String(e && e.stack));
  }
})();
