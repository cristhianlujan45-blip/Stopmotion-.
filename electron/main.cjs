// MESORA Studio desktop app (Windows, macOS, Linux).
const {
  app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell, systemPreferences,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library } = require('./core/library.cjs');

const WEB_ROOT = path.join(__dirname, '..', 'www');
const START_URL = 'app://mesora/index.html';

// Productions live as plain folders in Documents/MESORA (MESORA_LIBRARY overrides it, e.g. for tests).
let library = null;
const libraryRoot = () => process.env.MESORA_LIBRARY || path.join(app.getPath('documents'), 'MESORA');

// Only these Library methods can be called from the page.
const LIBRARY_METHODS = new Set([
  'listTakes', 'createProduction', 'createScene', 'createTake', 'duplicateScene', 'getProject', 'saveProject',
  'rename', 'ingestCapture', 'readCapture', 'readMeta', 'writeMeta', 'listTrash', 'putBlob', 'getBlob',
  'conform', 'listHistory', 'restoreHistory', 'markMigrated',
]);

function fromApp(event) {
  return event.senderFrame?.url?.startsWith('app://mesora/');
}

function serveLibrary() {
  library = new Library(libraryRoot());
  ipcMain.handle('library', (event, method, ...args) => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    if (!LIBRARY_METHODS.has(method)) throw new Error(`Operación no permitida: ${method}`);
    return library[method](...args);
  });
  ipcMain.handle('library:root', (event) => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    return library.root;
  });
  // Deleting never erases: the folder goes to the system trash, where it can be recovered.
  ipcMain.handle('library:trash', async (event, key, level) => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    const dir = await library.pathFor(key, level);
    await shell.trashItem(dir);
    library.forget(key, level);
  });
  ipcMain.handle('library:reveal', async (event, key, level = 'take') => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    const target = key ? await library.pathFor(key, level) : library.root;
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
  // Opens a folder created by the library (e.g. a conform); only inside the library.
  ipcMain.handle('library:revealPath', async (event, dir) => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    const target = path.resolve(String(dir));
    if (!target.startsWith(path.resolve(library.root) + path.sep)) throw new Error('Carpeta fuera de la biblioteca');
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
}

// A privileged "app://" scheme gives the page a secure origin, required for the
// camera, IndexedDB persistence and ES modules.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

function serveWebApp() {
  protocol.handle('app', (request) => {
    let pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = path.normalize(path.join(WEB_ROOT, pathname));
    if (!file.startsWith(WEB_ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function allowCamera() {
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'MESORA Studio',
      submenu: [
        { role: 'about', label: 'Acerca de MESORA Studio' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    }] : []),
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reducir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(isMac ? [{ role: 'zoom', label: 'Zoom' }] : [{ role: 'close', label: 'Cerrar' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MESORA Studio',
    backgroundColor: '#0e0f12',
    autoHideMenuBar: process.platform !== 'darwin',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // video export runs in real time
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the system browser; the app never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });

  mainWindow.loadURL(START_URL);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  serveWebApp();
  serveLibrary();
  allowCamera();
  buildMenu();
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera').catch(() => false);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
