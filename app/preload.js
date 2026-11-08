'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  fscommand: (cmd, arg) => ipcRenderer.send('fscommand', String(cmd), arg == null ? '' : String(arg)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  menuOpen: (open) => ipcRenderer.send('menu-open', !!open),
  escape: () => ipcRenderer.send('escape'),
});
