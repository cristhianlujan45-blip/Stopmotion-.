# MESORA Studio

Estudio de animación **stop motion** gratuito y de código abierto para **Windows, Mac,
Android** y el navegador (en Linux, desde el código fuente o en el navegador). Captura con una webcam, una cámara USB, tu
**réflex o sin espejo** (también en RAW) o la cámara del móvil; anima con papel
cebolla, X-Sheet, lip sync, luces DMX y motion control; y exporta en MP4, ProRes o
secuencias de imágenes.

*English: MESORA Studio is a free, open-source stop-motion studio. The interface is
available in Spanish and English (Help › Language). See [In English](#in-english).*

## Descargar e instalar

Las descargas están en la página de **[Releases](https://github.com/cristhianlujan45-blip/MESORA-/releases)**. Se generan solas con GitHub Actions.

| Sistema | Archivo | Cómo instalar |
| --- | --- | --- |
| **Windows 10/11** | `MESORA-Studio-Windows-Instalador-x.y.z.exe` | Ábrelo y sigue el asistente. Si Windows muestra «Windows protegió su PC», pulsa **Más información → Ejecutar de todas formas** (sale porque la app no tiene una firma de pago). |
| Windows sin instalar | `MESORA-Studio-Windows-Portable-x.y.z.exe` | Doble clic. Sirve para un pendrive o un equipo sin permisos de administrador. |
| **Mac** (Intel y Apple Silicon) | `MESORA-Studio-Mac-x.y.z.dmg` | Arrastra MESORA Studio a **Aplicaciones**. La primera vez: **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**, y acepta el permiso de cámara. |
| **Android 7+** | `MESORA-Studio-Android-x.y.z.apk` | Ábrelo en el móvil; si lo pide, permite **instalar apps de origen desconocido**. |

Las versiones nuevas se instalan encima sin perder tus proyectos.

**Versión web:** `npm start` y abre <http://localhost:5173> (o publícala en cualquier hosting con HTTPS). La cámara solo funciona en `https://` o `localhost`. Navegadores: Chrome/Edge 100+ (recomendado), Firefox o Safari recientes.

## Primeros pasos

- La primera vez aparece una **guía de inicio**. Con **Aprender paso a paso** (también en *Ayuda › Modo aprendizaje*) MESORA te acompaña en tu primera animación y avanza sola cuando haces cada cosa.
- Arriba eliges el modo: **Sencillo** (lo esencial, por defecto) o **Estudio** (añade X-Sheet, lip sync, luces, movimiento, atajos de captura múltiple…).
- **Idioma**: español o inglés, en la bienvenida o en *Ayuda*.
- Manual completo: [docs/manual.md](docs/manual.md).

## Funciones

**Captura**
- Webcam, cámara USB o capturadora HDMI hasta 4K, con promediado de ruido (2–16 cuadros), bloqueo de automáticos, retardo, intervalómetro y reconexión automática si se pierde la señal.
- **Réflex y sin espejo** de cualquier marca con su programa oficial (EOS Utility, NX Tether, Imaging Edge, X Acquire…): MESORA vigila la carpeta donde guarda las fotos y añade cada una en cuanto termina de escribirse. **RAW** (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG…) intacto, mostrado y exportado con su JPEG incrustado; RAW + JPEG cuentan como una sola foto.
- **Video assist**: con una webcam o capturadora a la vez, cada foto guarda también la imagen del vivo.
- **Foto de prueba** fuera de la animación y comparación A/B con el vivo.
- Capturar, reemplazar (`Shift+Enter`), insertar (`Alt+Enter`) o capturar un fotograma que dura N cuadros (`Ctrl+2…9`).

**Asistente de rodaje** (nunca cambia ni borra fotos)
- Tras cada foto avisa si la **cámara se movió** (cuántos píxeles y hacia dónde), si **cambió la luz**, si se **disparó dos veces**, si **entró algo por el borde** o si se **perdió el foco**.
- En vivo, antes de disparar, avisa si la luz o la cámara ya no coinciden con el último fotograma.
- **Revisar toda la toma** lista los fotogramas sospechosos y los muestra en modo diferencia.

**Visor y animación**
- Visor por GPU (WebGL2), con alternativa 2D.
- Papel cebolla anterior y siguiente, con tinte por dirección y modos «destacar lo claro / lo oscuro»; modo diferencia; parpadeo vivo/último.
- Croma en tiempo real, focus peaking, lupa 1:1, histograma, cuadrículas, máscaras de encuadre, zonas seguras y capa de guías.
- Referencia de vídeo o imagen (rotoscopia) sincronizada.
- **Segunda pantalla**: el visor a pantalla completa en otro monitor.
- **Estabilización de luz (deflicker)** al reproducir y exportar, sin tocar las fotos.

**Timeline y X-Sheet**
- Timeline con duración por fotograma, notas, selección múltiple, arrastrar, duplicar y deshacer ilimitado; reproducción completa, en bucle, ping-pong, corta y a ½ o ¼ de velocidad con el sonido sincronizado. 6–30 fps, 18 y personalizado.
- **X-Sheet** (modo Estudio): una fila por exposición con acción, diálogo, fonema, cámara, luz y notas. Lo planificado va unido al tiempo aunque cambien los fotogramas. Exportar/importar CSV e imprimir.

**Audio y lip sync**
- Varias pistas (diálogo, música, efectos) con volumen, silencio y exposición de inicio; ondas en el timeline; *scrub* fotograma a fotograma.
- **Lip sync**: personajes con su juego de bocas; la columna «Fonema» del X-Sheet dice qué boca va en cada exposición y el visor la muestra antes de cada foto. **Borrador automático** desde el diálogo (aproximado, por volumen).

**Luz DMX y motion control** (modo Estudio, desactivados por defecto)
- Antes de cada foto MESORA pone las luces y los ejes en su sitio para esa exposición, espera a que paren y dispara.
- Luces: looks y programa por exposición con fundidos; salida **Art-Net**, **ENTTEC DMX USB Pro** o simulador.
- Movimiento: ejes con claves y curvas de aceleración; **firmware Arduino propio (MESORA-Moco)** y simulador. Detalles, conexiones y qué se ha probado: [docs/luz-y-movimiento.md](docs/luz-y-movimiento.md).

**Revisión, mando y automatización**
- **Paquete de revisión**: un HTML que cualquiera abre en su navegador; escribe notas por fotograma y te devuelve un archivo que MESORA coloca en cada fotograma.
- **Móvil como mando** por wifi (con código QR): disparar, reproducir, moverse por los fotogramas y ver el visor.
- **API local** para otros programas: [docs/api-local.md](docs/api-local.md).

**Proyectos y seguridad**
- App de escritorio: cada producción es una carpeta en `Documentos/MESORA` (*Producción › Escena › Toma*), con las fotos originales como archivos normales que MESORA **nunca sobrescribe ni borra**. Papelera, historial de versiones del timeline, *conform* (copia en orden) y recuperación tras un cierre inesperado.
- **Copia de seguridad automática** cada 10 minutos a un disco externo o una carpeta en la nube; solo añade y actualiza.
- Web y Android: proyectos guardados en el navegador; copia completa en un archivo `.mesora`.

**Exportación**
- Escritorio (FFmpeg, fuera de tiempo real): **MP4 H.264**, **MOV ProRes 422 HQ**, **AVI Motion JPEG**, secuencias **PNG, TIFF o JPEG**, a la resolución original, 4K, 2K, 1080p, 720p o personalizada, con la mezcla de sonido.
- **Sonido (WAV)**: la mezcla de las pistas del tramo exportado.
- Web: MP4/WebM en tiempo real y secuencia ZIP. En todas: fotograma actual (PNG), paquete de revisión y `.mesora`.

## Atajos principales

| Tecla | Acción |
| --- | --- |
| `Enter` · `Shift+Enter` · `Alt+Enter` | Capturar · reemplazar · insertar |
| `Ctrl+2…9` | Capturar un fotograma que dura 2–9 cuadros |
| `0` / `Espacio` | Reproducir / parar |
| `1` / `←`, `3` / `→` | Fotograma anterior / siguiente |
| `2` / `Tab`, `5` / `Fin` | Alternar vivo ↔ último, ir al vivo |
| `6`, `8` / `L`, `P` | Reproducción corta, bucle, ping-pong |
| `O`, `D`, `B` | Papel cebolla, diferencia, parpadeo |
| `G`, `F`, `Z` | Cuadrícula, focus peaking, lupa |
| `+` / `−`, `N` | Duración del fotograma, nota |
| `Supr`, `Ctrl+D`, `Ctrl+Z` | Eliminar, duplicar, deshacer |
| `?` | Ayuda y todos los atajos |

Todos se pueden cambiar en *Ayuda*. Las teclas numéricas siguen la disposición del teclado numérico de los animadores profesionales.

## MESORA frente a Dragonframe

Comparación con la **documentación pública** de Dragonframe; el programa no se ha inspeccionado directamente ([docs/investigacion/](docs/investigacion/)). Detalle función por función y estado de verificación: [matriz de equivalencia](docs/investigacion/03-matriz-equivalencia.md).

| | MESORA Studio | Dragonframe |
| --- | --- | --- |
| Precio y licencia | Gratis, código abierto (GPL-3.0) | Licencia de pago |
| Plataformas | Windows, Mac, Android y navegador (Linux desde el código) | Windows, Mac y Linux |
| Réflex y sin espejo | Cualquier marca mediante la carpeta de su programa oficial; RAW | Control directo de Canon, Nikon, Sony… (live view y ajustes desde el programa) |
| Video assist + alta calidad | Sí | Sí |
| Papel cebolla, diferencia, parpadeo, croma, guías | Sí | Sí |
| X-Sheet, lip sync con bocas | Sí (borrador automático por volumen) | Sí (más completo: lectura de pistas, PSD de bocas) |
| Varias pistas de audio | Sí | Sí |
| Luces DMX (Art-Net, ENTTEC) | Sí, por exposición con fundidos | Sí, con curvas Bézier y más opciones |
| Motion control | Firmware Arduino propio y simulador | DFMoco y controladores comerciales; ejes virtuales, go-motion |
| Exportación ProRes / secuencias / WAV | Sí | Sí |
| Asistente que avisa tras cada foto (golpe, luz, duplicado, mano, foco) | **Sí** | No aparece en la documentación ni en el historial de versiones revisados |
| Deflicker integrado | **Sí** | No aparece en su página de funciones ni en su historial de versiones |
| Mando | El propio móvil por wifi, gratis | Teclado y mando propios, que se venden aparte |

MESORA añade además copias de seguridad automáticas, una API local, paquetes de revisión con notas por fotograma, un modo aprendizaje y un modo sencillo.

**Lo que todavía no tiene MESORA** (con honestidad):
- **Control directo por USB** de cámaras Canon, Nikon o Sony (cambiar ISO, apertura o enfocar desde MESORA, live view de la réflex). Necesita los SDK de cada fabricante, que hay que solicitarles. Mientras tanto, la carpeta vigilada funciona con cualquier cámara y su programa oficial.
- Exposiciones múltiples por fotograma (X1…X12), multicámara, curvas Bézier en luces, ejes virtuales y go-motion.
- Compatibilidad con controladores DFMoco (MESORA usa su propio protocolo abierto).
- El hardware (cámaras réflex reales, luces DMX, motores) no se ha probado en este desarrollo: se ha verificado con simuladores y archivos de prueba. Ver [informe de pruebas](docs/pruebas/informe-fases-1-10.md).

## Compilar y probar

```bash
npm install
npm test                   # pruebas unitarias (también compila y prueba el firmware si hay compilador de C++)
npm run build:web          # prepara www/
npm run test:viewer        # pruebas de píxel del visor (app de escritorio)
npm run test:e2e           # prueba de principio a fin de la app de escritorio
npm run desktop            # abrir la app de escritorio en modo desarrollo
npm run dist:win           # Windows: instalador + portable en dist/
npm run dist:mac           # Mac: .dmg (en un Mac)
npm run android:apk        # Android (necesita Android SDK y Java 21)
```

En Linux sin pantalla, antepón `xvfb-run -a` a `test:viewer` y `test:e2e`.
El workflow `.github/workflows/build-apps.yml` prueba en Windows, Mac y Linux y compila las tres apps; publica una release con cada etiqueta `vX.Y.Z` y actualiza la pre-release «última versión» con cada cambio en la rama principal.

**Firmas:** el APK de Android se firma con una clave pública incluida en el repositorio (para instalar encima de la versión anterior; para Google Play usa la tuya con `MESORA_KEYSTORE`…). Windows y macOS muestran un aviso la primera vez porque las apps no tienen firma de pago (Authenticode / Apple Developer ID); con un certificado, electron-builder firma solo (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`).

## Estructura

```
index.html, css/          interfaz
js/app.js                 orquestación de la app
js/library.js, migrate.js biblioteca (disco en escritorio, IndexedDB en web)
js/camera.js              cámara, controles y promediado
js/viewer-gl.js, viewer.js visor GPU (WebGL2) y 2D
js/assistant.js           asistente de rodaje
js/audio.js, lipsync.js   audio multipista y lip sync
js/xsheet.js, timeline.js X-Sheet y timeline
js/dmx.js, moco.js, rig.js luces DMX y motion control
js/review.js, learn.js    paquete de revisión, modo aprendizaje
js/i18n.js, i18n-en.js    idiomas
electron/                 app de escritorio: biblioteca en disco, FFmpeg, carpeta vigilada,
                          mando del móvil, copias de seguridad, Art-Net
firmware/mesora-moco/     firmware Arduino de motion control y su banco de pruebas
android/                  app de Android (Capacitor)
tests/                    pruebas unitarias y E2E
docs/                     manual, investigación, auditoría, pruebas y referencias
```

## Código abierto

MESORA Studio es **software libre y gratuito** bajo la licencia [GPL-3.0-or-later](LICENSE): puedes usarlo para cualquier fin, también comercial, estudiar y modificar su código y compartirlo; las versiones modificadas que distribuyas deben seguir siendo libres con la misma licencia. Componentes de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## In English

MESORA Studio is a free, open-source (GPL-3.0) stop-motion studio for Windows, macOS,
Android and the web (Linux from source). Highlights: webcam and HDMI capture; DSLR and mirrorless
cameras of any brand through their official tethering software (watched folder, RAW
kept untouched, video assist); a shooting assistant that warns about camera bumps,
light changes, double shots, hands in frame and lost focus; GPU viewer with onion
skin, difference, chroma key and focus aids; X-Sheet, multitrack audio and lip sync
with mouth sets; DMX lighting (Art-Net, ENTTEC) and motion control with an
open Arduino firmware and simulators; FFmpeg export to MP4, ProRes, AVI and image
sequences; phone remote and local API; review packages with per-frame notes;
automatic backups; a learning mode; and a Simple/Studio interface. Switch the
interface to English in *Ayuda › Idioma* (Help › Language).
