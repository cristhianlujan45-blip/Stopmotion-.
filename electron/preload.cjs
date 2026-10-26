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
  library: {
    call: (method, ...args) => ipcRenderer.invoke('library', method, ...args),
    root: () => ipcRenderer.invoke('library:root'),
    trash: (key, level) => ipcRenderer.invoke('library:trash', key, level),
    reveal: (key, level) => ipcRenderer.invoke('library:reveal', key, level),
    revealPath: (dir) => ipcRenderer.invoke('library:revealPath', dir),
  },
});
