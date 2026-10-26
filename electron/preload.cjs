// Tells the web app it is running inside the desktop app and gives it access
// to the production library on disk.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mesoraDesktop', {
  platform: process.platform,
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    openLog: () => ipcRenderer.invoke('app:openLog'),
  },
  export: {
    available: () => ipcRenderer.invoke('export:available'),
    start: (key, spec) => ipcRenderer.invoke('export:start', key, spec),
    frame: (id, bytes, times) => ipcRenderer.invoke('export:frame', id, bytes, times),
    finish: (id) => ipcRenderer.invoke('export:finish', id),
    cancel: (id) => ipcRenderer.invoke('export:cancel', id),
    wav: (key, spec) => ipcRenderer.invoke('export:wav', key, spec),
    reveal: (target) => ipcRenderer.invoke('export:reveal', target),
  },
  library: {
    call: (method, ...args) => ipcRenderer.invoke('library', method, ...args),
    root: () => ipcRenderer.invoke('library:root'),
    trash: (key, level) => ipcRenderer.invoke('library:trash', key, level),
    reveal: (key, level) => ipcRenderer.invoke('library:reveal', key, level),
    revealPath: (dir) => ipcRenderer.invoke('library:revealPath', dir),
  },
});
