// Tells the web app it is running inside the desktop app.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mesoraDesktop', {
  platform: process.platform,
});
