// Detects where MESORA runs (browser, desktop app, Android app) and saves
// files the right way on each.
import { downloadBlob } from './util.js';

const cap = window.Capacitor;

/** Android app (Capacitor). */
export const isAndroidApp = !!cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android';
/** Windows / macOS / Linux desktop app (Electron). */
export const isDesktopApp = !!window.mesoraDesktop;
export const isApp = isAndroidApp || isDesktopApp;

const ANDROID_FOLDER = 'MESORA';
const CHUNK = 3 * 1024 * 1024;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function writeNative(blob, path, directory) {
  // The bridge only carries text, so large files go across in base64 chunks.
  for (let offset = 0; offset < Math.max(blob.size, 1); offset += CHUNK) {
    const data = await blobToBase64(blob.slice(offset, offset + CHUNK));
    if (offset === 0) await cap.nativePromise('Filesystem', 'writeFile', { path, data, directory, recursive: true });
    else await cap.nativePromise('Filesystem', 'appendFile', { path, data, directory });
  }
}

/**
 * Saves a file for the user. On Android it is written to Documents/MESORA
 * and the share sheet opens (Drive, Galería, WhatsApp…).
 * @returns {Promise<string>} human-readable location, or '' for browser downloads
 */
export async function saveFile(blob, filename) {
  if (!isAndroidApp) {
    downloadBlob(blob, filename);
    return '';
  }
  const path = `${ANDROID_FOLDER}/${filename}`;
  let directory = 'DOCUMENTS';
  try {
    await writeNative(blob, path, directory);
  } catch {
    directory = 'CACHE';
    await writeNative(blob, path, directory);
  }
  try {
    const { uri } = await cap.nativePromise('Filesystem', 'getUri', { path, directory });
    await cap.nativePromise('Share', 'share', { title: filename, files: [uri], dialogTitle: 'Guardar o compartir' });
  } catch {
    // The user closed the share sheet: the file is still saved.
  }
  return directory === 'DOCUMENTS' ? `Documentos/${ANDROID_FOLDER}` : '';
}
