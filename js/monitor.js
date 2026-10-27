// Second screen: a window that mirrors the viewer (for a big monitor or a
// client screen). The desktop app opens it full-screen on the external display.

/** Opens or refreshes the monitor window. Returns it, or null when the browser blocks pop-ups. */
export function openMonitor(canvas) {
  const win = window.open('', 'mesora-monitor', 'popup,width=1280,height=720');
  if (!win) return null;
  const doc = win.document;
  let video = doc.getElementById('monitor');
  if (!video) {
    doc.title = 'MESORA · Monitor';
    doc.body.style.cssText = 'margin:0;background:#000;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden';
    video = doc.createElement('video');
    video.id = 'monitor';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:contain';
    const hint = doc.createElement('div');
    hint.textContent = 'Doble clic: pantalla completa';
    hint.style.cssText = 'position:fixed;bottom:12px;left:0;right:0;text-align:center;color:#888;font:13px system-ui;transition:opacity 1s';
    doc.body.append(video, hint);
    setTimeout(() => { hint.style.opacity = '0'; }, 3000);
    doc.addEventListener('dblclick', () => {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else doc.documentElement.requestFullscreen().catch(() => {});
    });
  }
  video.srcObject = canvas.captureStream(30);
  video.play().catch(() => {});
  win.focus();
  return win;
}
