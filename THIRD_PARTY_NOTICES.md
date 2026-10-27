# Componentes de terceros

MESORA Studio es software libre bajo la licencia [GPL-3.0-or-later](LICENSE). Las
aplicaciones que se distribuyen incluyen además estos componentes, cada uno con
su propia licencia:

| Componente | Versión | Licencia | Dónde se usa |
|---|---|---|---|
| [FFmpeg](https://ffmpeg.org) (binario de [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) | FFmpeg 6.0 (ffmpeg-static 5.2.0, binarios de la versión `b6.0`) | GPL-3.0 | App de escritorio: exportar películas (MP4, ProRes, AVI) e imágenes (PNG, TIFF, JPEG) |
| [Electron](https://www.electronjs.org) (incluye Chromium y Node.js) | 45 | MIT; Chromium y sus componentes con sus propias licencias | App de escritorio |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | App de escritorio: el código QR del mando del móvil |
| [Capacitor](https://capacitorjs.com) | 8 | MIT | App de Android |

Solo para desarrollo y pruebas (no van dentro de las apps): electron-builder (MIT),
playwright-core (Apache-2.0).

## FFmpeg

- El binario de FFmpeg se distribuye **sin modificar** dentro de la app de
  escritorio, en `resources/app.asar.unpacked/node_modules/ffmpeg-static/`, junto
  con su licencia (`ffmpeg.LICENSE`, GPL versión 3) y la descripción de la
  compilación (`ffmpeg.README`: versión y bibliotecas incluidas, como libx264).
- En macOS se combinan los binarios de Intel y Apple Silicon en uno universal con
  `lipo` (`scripts/ffmpeg-mac-universal.sh`); el código no cambia.
- Código fuente de FFmpeg 6.0: <https://ffmpeg.org/releases/ffmpeg-6.0.tar.xz>.
  Origen de los binarios usados: <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0>
  (los de Linux son compilaciones de John Van Sickle: <https://johnvansickle.com/ffmpeg/>).
- MESORA llama a FFmpeg como programa externo, en un proceso aparte.

Quien distribuya las apps debe cumplir la GPL-3.0 también para FFmpeg; en
particular, poner a disposición el código fuente correspondiente de los
binarios que distribuye.

## Electron y Chromium

Las licencias de Chromium y de sus componentes se incluyen en cada instalación de
la app de escritorio, en el archivo `LICENSES.chromium.html` que acompaña al
ejecutable, y la de Electron en `LICENSE.electron.txt`.

## Formatos y protocolos

- **Art-Net** es una marca de Artistic Licence; MESORA implementa el paquete
  ArtDmx según su especificación pública.
- **ENTTEC DMX USB Pro** es un producto de ENTTEC; MESORA implementa el mensaje
  de envío DMX (label 6) según su documentación pública.
- **MESORA-Moco** (protocolo y firmware en `firmware/`) es original de este
  proyecto y se distribuye con la misma licencia GPL-3.0-or-later.
- MESORA no incluye código, recursos ni protocolos propietarios de Dragonframe.
  Las comparaciones con Dragonframe se basan en su documentación pública
  (`docs/investigacion/`).
