// Копирует Ruffle из node_modules в ui/ruffle (папка не хранится в git).
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.dirname(require.resolve('@ruffle-rs/ruffle/package.json'));
const dst = path.join(__dirname, '..', 'ui', 'ruffle');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
let total = 0;
for (const f of fs.readdirSync(src)) {
  if (!/\.(js|wasm)$/.test(f)) continue; // без .map, README и package.json
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  total += fs.statSync(path.join(dst, f)).size;
}
for (const f of ['LICENSE_MIT', 'LICENSE_APACHE']) {
  if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log(`Ruffle -> ui/ruffle (${(total / 1048576).toFixed(1)} MB)`);
