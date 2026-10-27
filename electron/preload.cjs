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
    saveFile: (key, spec) => ipcRenderer.invoke('export:saveFile', key, spec),
    reveal: (target) => ipcRenderer.invoke('export:reveal', target),
  },
  camera: {
    chooseFolder: () => ipcRenderer.invoke('camera:chooseFolder'),
    watch: (key, dir) => ipcRenderer.invoke('camera:watch', key, dir),
    retarget: (key) => ipcRenderer.invoke('camera:retarget', key),
    unwatch: () => ipcRenderer.invoke('camera:unwatch'),
    onPhoto: (cb) => ipcRenderer.on('camera:photo', (_e, data) => cb(data)),
    onError: (cb) => ipcRenderer.on('camera:error', (_e, msg) => cb(msg)),
  },
  remote: {
    start: () => ipcRenderer.invoke('remote:start'),
    stop: () => ipcRenderer.invoke('remote:stop'),
    state: (s) => ipcRenderer.send('remote:state', s),
    preview: (bytes) => ipcRenderer.send('remote:preview', bytes),
    onAction: (cb) => ipcRenderer.on('remote:action', (_e, action) => cb(action)),
    onActive: (cb) => ipcRenderer.on('remote:active', (_e, active) => cb(active)),
  },
  library: {
    call: (method, ...args) => ipcRenderer.invoke('library', method, ...args),
    root: () => ipcRenderer.invoke('library:root'),
    trash: (key, level) => ipcRenderer.invoke('library:trash', key, level),
    reveal: (key, level) => ipcRenderer.invoke('library:reveal', key, level),
    revealPath: (dir) => ipcRenderer.invoke('library:revealPath', dir),
  },
});
