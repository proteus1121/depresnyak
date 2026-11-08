// Самотест без реальной мыши: CAT_SELFTEST=<папка для снимков>.
// Делает снимки окна, открывает меню кота правым кликом (sendInputEvent),
// выбирает пункт и снимает результат.
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function selftest(win, outDir) {
  const wc = win.webContents;
  fs.mkdirSync(outDir, { recursive: true });
  const snap = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
    return img;
  };
  // Ищем непрозрачную точку (кота) ближе к центру.
  const findCat = (img) => {
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    let best = null;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        if (bmp[(y * width + x) * 4 + 3] > 200) {
          const d = (x - width / 2) ** 2 + (y - height / 2) ** 2;
          if (!best || d < best.d) best = { x, y, d };
        }
      }
    }
    return best;
  };
  const items = () =>
    wc.executeJavaScript(`(() => {
      const p = document.querySelector('ruffle-player');
      const root = p && p.shadowRoot;
      if (!root) return [];
      return [...root.querySelectorAll('#context-menu .menu-item, #context-menu li')].map((e) => e.textContent.trim());
    })()`);
  const clickItem = (text) =>
    wc.executeJavaScript(`(() => {
      const root = document.querySelector('ruffle-player').shadowRoot;
      const el = [...root.querySelectorAll('#context-menu .menu-item, #context-menu li')].find((e) => e.textContent.trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  try {
    await sleep(4000);
    let img = await snap('01_start');
    for (let i = 0; i < 20 && !findCat(img); i++) {
      await sleep(500);
      img = await snap('01_start');
    }
    const pt = findCat(img);
    console.log('SELFTEST size', JSON.stringify(img.getSize()), 'cat point', JSON.stringify(pt));
    if (!pt) return;
    // координаты capturePage в физических пикселях, sendInputEvent — в DIP
    const k = img.getSize().width / win.getContentBounds().width;
    const x = Math.round(pt.x / k);
    const y = Math.round(pt.y / k);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'contextMenu', x, y, button: 'right' });
    await sleep(800);
    await snap('02_menu');
    const list = await items();
    console.log('SELFTEST menu items', JSON.stringify(list));
    const want = process.env.CAT_SELFTEST_ITEM || 'Сидеть';
    console.log('SELFTEST click', want, await clickItem(want));
    for (let i = 1; i <= 6; i++) {
      await sleep(1500);
      await snap('03_after_' + i);
    }
    const about = await (async () => {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
      wc.sendInputEvent({ type: 'contextMenu', x, y, button: 'right' });
      await sleep(800);
      return clickItem('О программе');
    })();
    console.log('SELFTEST about clicked', about);
    await sleep(1000);
  } catch (e) {
    console.log('SELFTEST error', e && e.stack);
  } finally {
    console.log('SELFTEST done');
  }
};
