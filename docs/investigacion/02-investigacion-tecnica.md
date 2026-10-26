# Etapa 2 · Investigación técnica

Fecha: 26-10-2026. La inspección directa no se ha podido realizar (ver `01-inspeccion-directa.md`), así que todo lo que sigue procede de documentación.

## Clave de evidencia

| Etiqueta | Significado |
|---|---|
| **[OBS]** | Observado directamente en este trabajo. Para Dragonframe: **nada todavía**. Solo se aplica al código de MESORA. |
| **[DOC]** | Documentado oficialmente por Dragonframe (manual, FAQ, web, protocolo publicado) o por el fabricante del estándar o SDK. |
| **[TER]** | Fuente de terceros (cursos, foros, librerías). Útil, pero hay que verificarla. |
| **[DED]** | Deducido a partir de lo anterior. No confirmado. |
| **[DESC]** | Desconocido. Hay que averiguarlo antes de implementar algo que dependa de ello. |

**Advertencia de versión:** la fuente oficial más completa que se pudo leer es el manual *Using Dragonframe 4* (382 páginas, descargado de dragonframe.com). La versión actual es de la serie 2026 [DOC]. Lo añadido entre DF5 y 2026 se toma del historial oficial de versiones. Por eso, el aspecto y la ubicación exacta de los controles en la versión instalada del usuario son **[DESC]** hasta la inspección directa.

## Fuentes

| # | Fuente | Tipo | Notas |
|---|---|---|---|
| S1 | [Using Dragonframe 4 (PDF oficial)](https://www.dragonframe.com/download/Using%20Dragonframe%204.pdf) | DOC | Leído en texto extraído localmente; el capítulo se cita como «Manual DF4, p. N» |
| S2 | [Dragonframe Software: página de funciones](https://www.dragonframe.com/dragonframe-software/) | DOC | Lista comercial de funciones actual |
| S3 | [Historial de versiones DF3 → 2026](https://www.dragonframe.com/ufaqs/what-has-changed-from-df3-to-df4-or-df4-to-df5here-is-the-dragonframe-feature-version-history/) | DOC | |
| S4 | [Simple Interface (serie/TCP)](https://www.dragonframe.com/ufaqs/using-the-simple-interface-to-receive-notifications-and-send-commands-to-dragonframe-via-serial-or-tcp/) | DOC | |
| S5 | [DMC v2 COMM Protocol, 2024-08-13 (PDF)](https://dragonframe.com/download/dmcproto/DMC-Protocol-2024-08-13.pdf) | DOC | Publicado «para compartir» con fabricantes de terceros |
| S6 | [Integrar un sistema de motion control](https://www.dragonframe.com/ufaqs/how-do-i-integrate-a-motion-control-system-with-dragonframe/) | DOC | Ubicación de DFMoco y de su protocolo |
| S7 | [Hardware DMX compatible](https://www.dragonframe.com/ufaqs/what-hardware-is-compatible-with-dragonframes-dmx-workspace/) | DOC | |
| S8 | [Camera Support](https://www.dragonframe.com/camera-support/) y [cámaras sin espejo](https://www.dragonframe.com/ufaqs/what-mirrorless-cameras-can-i-use/) | DOC | Tabla de modelos no leída completa |
| S9 | [Descargas y notas de versión](https://dragonframe.com/downloads) | DOC | Última de 2025: 2025.09.5; serie 2026: 2026.01.1 o posterior |
| S10 | [Implementación Python de DFMoco (CMU)](https://courses.ideate.cmu.edu/60-428/s2018/ref/text/_modules/ase/DFMocoProtocol.html) | TER | Protocolo 1.3.0 |
| S11 | Canon SDK: [Canon Europe](https://canon-europe.com/business/imaging-solutions/sdk), [Canon Oceania](https://www.canon.co.nz/support/support-news/support-news/digital-slr-camera-software-developers-kit) | DOC fab. | |
| S12 | [Sony Camera Remote SDK](https://support.d-imaging.sony.co.jp/app/sdk/en/index.html) | DOC fab. | v2.02.00 (junio de 2026) |
| S13 | Nikon SDK (solicitud en sdk.nikonimaging.com/apply; referencia indirecta) | TER | No se pudo leer la página oficial |
| S14 | [libgphoto2 no funciona en Windows (RTIAcquire)](https://github.com/rti-capture/rtiacquire) | TER | |
| S15 | API de ENTTEC DMX USB Pro v1.44 ([copia](https://git.dgnum.eu/HackENS/pyjecteur/raw/branch/main/API_DOC.pdf)) | DOC fab. (copia) | |
| S16 | Art-Net 4 (Artistic Licence); detalles vía [artnet_protocol](https://docs.rs/artnet_protocol) | TER | Falta leer la especificación original |
| S17 | [Electron: acceso a dispositivos y Web Serial](https://www.electronjs.org/docs/latest/tutorial/devices) | DOC | |
| S18 | Licencias de FFmpeg ([lista FFmpeg](https://ffmpeg.org/pipermail/libav-user/2013-March/004053.html), [Qt: FFmpeg](https://doc.qt.io/qt-6.5/qtwebengine-3rdparty-ffmpeg.html)) | DOC/TER | |

---

## A. Modelo de funcionamiento de Dragonframe

### A1. Dos secuencias en paralelo: video assist y alta calidad [DOC, S1 p. 1–2]
- Dragonframe genera **dos secuencias a la vez**: fotogramas de baja resolución tomados de la señal en vivo (*video assist* o *feed*), que sirven para animar, y fotogramas de **alta calidad** de la cámara (RAW o JPEG de la réflex), que son el resultado final.
- Al pulsar SHOOT: (1) guarda un fotograma de la señal en vivo, en disco y en RAM; (2) pasa la cámara a modo de captura de alta calidad y dispara la foto; (3) descarga la foto al disco de inmediato.
- Hay otras configuraciones: solo vídeo HD, réflex sin live view más una señal de vídeo aparte, o réflex sin vídeo en vivo.
- **Implicación para MESORA [DED]:** el modelo de datos tiene que separar *fuente de visualización* y *fuente de captura*, y mantener ambas secuencias sincronizadas. MESORA hoy genera la vista previa y el original a partir de la misma imagen de la webcam [OBS].

### A2. Jerarquía de archivos [DOC, S1 p. 9 y 335]
- **Escena** = proyecto (archivo `.dgn` dentro de la carpeta de escena). La escena contiene **tomas** (*takes*) y cada toma contiene **exposiciones** (X1…X12; hasta 12 por toma).
- Nombres del tipo `Sample_001_01_X1_0001.jpg`, es decir, escena_número_toma_exposición_fotograma.
- Carpetas por toma: `_backup` (capturas y feed **borrados**), `_feed` (video assist en JPEG), `hq` (proxies para reproducción) y `X1…Xn` (originales en alta calidad).
- **«All frame editing is virtual»**: las ediciones (borrar, mover, hold) no tocan los archivos. Para tener los archivos renumerados en el orden final hay que hacer un **conform** de la toma.
- No reprocesa los RAW. Si la cámara graba RAW+JPEG, descarga ambos con el mismo nombre. Si solo graba RAW, usa el JPEG incrustado para mostrarlo [DOC, S1 p. 11].
- **Implicación [DED]:** este es el principio de seguridad que pide el proyecto (no perder originales nunca). MESORA debe adoptar originales inmutables, una lista de edición virtual y una papelera, con su **propio** diseño de nombres y carpetas (ver `04-arquitectura.md`).

### A3. Pasadas, tomas y exposiciones [DOC, S1 p. 9–10, 94]
- Una **pasada recta** (*clean plate*, fondo para croma) se hace como **toma nueva**.
- Una **pasada por subfotograma** (varias imágenes por instante: HDR, pasadas de luz, estéreo) se hace con **exposiciones** dentro de la toma, cada una con sus propios ajustes de cámara y, opcionalmente, su propio programa DMX.
- La captura automática por exposición está documentada: «Shoot Multiple» requiere auto-capture activo en todas las exposiciones [DOC, S1 p. 117].

### A4. Espacios de trabajo [DOC, S1 p. 13; S3]
Animation, Cinematography, Audio, DMX y Arc Motion Control, más el **X-Sheet** como panel lateral acoplado (desde DF3: «Docked X-Sheet»). Las versiones 5.x/2024+ añaden más elementos (Notepad, multicámara, etc.; ver A12).

### A5. Animation [DOC, S1 cap. 7; S2]
- **Live / step / auto toggle**: alternar entre la imagen en vivo y el último fotograma, o paso a paso.
- **Reproducción**: velocidad de reproducción independiente del frame rate del proyecto («only change the playback speed if you want to temporarily view…»), bucle, **short play** (últimos N fotogramas, 12 por defecto), reproducción en alta resolución y **Nav-Line** con puntos de entrada y salida (teclas `I`/`O`) que pueden ir más allá de lo rodado para escuchar el audio [S1 p. 116].
- **Shoot Multiple**: `Ctrl+2…Ctrl+0` dispara de 2 a 10 fotogramas. Opción de *virtual holds*: una sola foto y holds para el resto [S1 p. 117].
- **Onion skin** [S1 p. 121–123]:
  - Un deslizador de opacidad. A la derecha mezcla el **último** fotograma sobre el vivo (solo en el fotograma listo para capturar). A la izquierda mezcla el **vivo sobre el fotograma** en el que estés.
  - Modos: Normal, **Difference** (lo igual se ve negro y las diferencias en gris o blanco), **Darks prominent** y **Lights prominent** (con «Frame Echo»).
  - Deslizador de número de fotogramas: hasta **5** fotogramas superpuestos.
  - Ajuste fino con las teclas ONIONSKIN LEFT/RIGHT del keypad.
- **Roto layers**, dibujo sobre la vista, **punch-in** (ampliación del live view), niveles del video assist y monitor externo [S1 p. 124–125].
- Teclas de acceso configurables y monitor auxiliar [S2].

### A6. Timeline [DOC, S1 p. 131–141]
- Miniatura del primer fotograma de cada exposición. Seleccionar un fotograma selecciona todas sus exposiciones.
- **Arrastrar hacia arriba** mueve solo la selección: un marcador amarillo indica *insertar* y uno rojo con X indica *sobrescribir*. **Arrastrar en horizontal** desplaza todo hasta el principio o el final de la secuencia.
- Cortar, copiar, pegar (incluido pegar en orden inverso desde el teclado), **hold** (diálogo o arrastrando el borde derecho), ocultar, borrar y **recuperar de la papelera** («delete bin»).
- Ajuste de capas de referencia desde el timeline y área de *pre-roll* (DF4.0) [S3].

### A7. X-Sheet [DOC, S1 cap. 11]
- Se actualiza al disparar. Marca con **X** las exposiciones capturadas y con **C** la siguiente que se va a capturar. Fotograma actual frente a fotograma seleccionado.
- Cabecera con datos de producción editables (animador, nota) y **longitud de escena** (48 por defecto; crece al pasarla) con fotograma inicial y final, que también está en Scene › Settings.
- Edición de fotogramas desde el X-Sheet, importación de datos, **notas recordatorio**, notas de postproducción, dibujo sobre el X-Sheet, información de audio, **impresión** y **exportación a CSV**.

### A8. Audio y Lip sync [DOC, S1 cap. 9–10; S2]
- Pistas de audio múltiples, carga, *scrub*, edición básica y exportación de la pista editada [S1 p. 161–167].
- **Face sets** creados como **capas de Photoshop** (PSD multicapa) [S1 p. 171]. **Personajes** con su propia fila de *track reading*: bocas, fonética y diálogo [S1 p. 175].
- Marcadores con nombre y navegación con `Ctrl+flechas`. La lectura se ve en el **timeline** (con formas) y en el **X-Sheet** (sin formas). **HUD** en el espacio Animation [S1 p. 182].
- Exportar e importar el track reading, vista previa del track reading y **time remap para After Effects** [S1 p. 183–185].
- **Time-Warp**: el audio se mantiene sincronizado al cambiar la velocidad [S2].

### A9. DMX [DOC, S1 cap. 13; S7]
- Dragonframe hace de mesa de luces por software. Necesita hardware: DDMX-512, DDMX-S2, DMC-16, DMC+ y DMC-32 (propios), **ENTTEC DMX USB Pro / Pro Mk2** y **Art-Net** [S1 p. 211–212; S7].
- Programas de luz por **keyframes**, tabla de keyframes, grupos de canales, filtros, guardar y cargar canales, **perfiles de luz personalizados**, vista previa, tomas de prueba, **luz de trabajo (bash light)** automática y programas distintos **por exposición** [S1 p. 216–236].
- Entradas y salidas: triggers de entrada, relés y salidas lógicas (con DDMX-512) [S1 p. 241–245].
- 2025.01 añade canales de «valor único» y 2025.05 un histograma DMX [S3].

### A10. Motion control [DOC, S1 cap. 14; S4–S6]
- **Arc Motion Control** propio: ejes, keyframes y curvas, move tests, *jogpad*, gamepad, ejes **virtuales** (cartesianos), importación y exportación 3D (Maya, Kuper) y *time warp* [S1 p. 249–315; S2].
- **DFMoco**: sketch de Arduino oficial, de 4 a 8 canales de *step/dir*, solo **shoot-move-shoot** (no tiempo real). La especificación oficial está en `DFMoco_Protocol.rtf`, que se instala con Dragonframe [DOC, S6].
- Protocolo DFMoco según una implementación de terceros [TER, S10], **pendiente de verificar con el .rtf oficial**:
  - Líneas ASCII terminadas en `\r\n` y motores numerados desde 1.
  - Del ordenador al dispositivo: `hi`, `ms`, `mm <m> <pos>`, `mp <m>`, `pr <m> <pps>`, `sm <m>`, `sa`, `jm`, `im`, `zm <m>`, `np <m> <pos>`.
  - Del dispositivo al ordenador: `hi <major> <ejes> <versión>`, `ms <banderas 0/1 por eje>`, `mp <m> <pos>`.
  - La velocidad en baudios **[DESC]**.
- **DMC v2** [DOC, S5]: protocolo **binario** con IDs de mensaje y **checksum Fletcher-16**. Cubre motores, DMX, E/S de propósito general, movimientos en tiempo real, go-motion y ejes virtuales. Dragonframe lo publica para que fabricantes de terceros lo implementen en sus dispositivos.
- **Simple Interface** [DOC, S4]: serie (56000 baudios, 8N1) o TCP (puerto **[DESC]**), líneas con `\r\n`.
  - Comandos: `S n` (disparar), `D`, `P`, `L`, `SF`/`SB`, `SP`, `OU`/`OD`…
  - Notificaciones: `SH`, `CC` (captura completa), `PF`, `DE`.
  - Sirve para mandos y triggers externos.

### A11. Exportación [DOC, S1 p. 335–346]
- Acceso directo a los originales. Exportar película de la toma con formatos H.264/AAC MP4 (no disponible en Linux), MOV sin compresión, Animation, Photo JPEG y **ProRes**, AVI sin compresión o MJPEG, y WMV.
- Exportar secuencia de imágenes (convertir formato, escalar, renombrar), exportar metadatos de postproducción y película estéreo.
- 2025.09 añade «step by tags» al exportar [S3].

### A12. Novedades DF5 → 2026 relevantes [DOC, S3]
- Multicámara (hasta 8), captura *making-of*, capa «Past Takes», **Frame Tags**, NDI de entrada y salida, OCIO (gestión de color) y *burst mode*.
- 2025.09: «SOLO CAMERA». 2026.01: «Play by Tags», cámaras panorámicas y decodificación por hardware (NVDEC).

### A13. Plataformas [DOC, S2]
macOS, Windows y Linux. Dragonframe 3.5 fue una **reescritura en C++** (antes Java) [DOC, S3]. El framework de interfaz que usa es **[DESC]**.

---

## B. Cámaras: SDK y vías de conexión

| Vía | Plataformas | Live view | Captura a disco | Acceso | Fuente |
|---|---|---|---|---|---|
| **Canon EDSDK** | Windows, macOS, Linux (según Canon) | Sí (función documentada) | Sí | Registro en el programa de desarrolladores de Canon. En Oceanía **no se da a particulares**; «as is», sin soporte | DOC fab. S11 |
| **Sony Camera Remote SDK** v2.02 | Windows, macOS, Linux [DED, a verificar] | Sí en la mayoría; Sony avisa de que hay modelos sin live view | Sí | Descarga con acuerdo de licencia; disponibilidad según país. Modelos: α1/α1 II, α9 II/III, α7 IV/V, α7R IV/V/VI, α7S III, α7C/II, α6700, FX3/FX6… | DOC fab. S12 |
| **Nikon SDK** (MAID3 por modelo) | Windows, macOS | Sí [TER] | Sí | Solicitud en sdk.nikonimaging.com; un SDK por modelo | TER S13 |
| **Fujifilm X SDK** | **[DESC]** | [DESC] | [DESC] | **[DESC]** (no investigado todavía) | — |
| **OM System / Olympus** | **[DESC]** | [DESC] | [DESC] | [DESC] | — |
| **libgphoto2** (LGPL) | Linux y macOS. **No funciona en Windows** | Sí en muchos modelos (en un recuento antiguo, unos 309 de 489 que capturan) | Sí | Libre | TER S14 |
| **UVC / webcam / capturadora HDMI / réflex en modo webcam** (`getUserMedia` / Media Foundation) | Todas | Sí | Captura **del flujo de vídeo** (no del sensor completo de la réflex) | Libre. **Ya funciona en MESORA** [OBS] | — |
| **Carpeta vigilada** (*folder watching*) | Todas | No (o vía HDMI aparte) | El software del fabricante descarga y MESORA importa | Libre. Dragonframe también la ofrece [DOC, S2] | — |

**Conclusiones [DED]:**
1. Ningún SDK de marca puede incluirse en el repositorio ni descargarse desde esta sesión: requieren registro y aceptar licencias. El **usuario (o su organización)** tendrá que registrarse. Por eso la arquitectura necesita **adaptadores** que se compilen solo si el SDK está presente.
2. **Prioridad recomendada** para la primera versión profesional en Windows: **Canon EDSDK** (la marca más recomendada por Dragonframe para stop motion [DOC, S8]) y **Sony CRSDK** (licencia más accesible). Después, Nikon.
3. Mientras no haya SDK: **carpeta vigilada** y **UVC/HDMI** son vías reales y no simuladas. La carpeta vigilada da archivos RAW originales de cualquier cámara a través del software de tethering del fabricante (EOS Utility, NX Tether, Imaging Edge…). La señal HDMI sirve como video assist. Es la configuración «réflex con señal de vídeo aparte» que documenta Dragonframe [DOC, S1 p. 2].

## C. Iluminación: protocolos

| Protocolo | Datos clave | Fuente |
|---|---|---|
| **ENTTEC DMX USB Pro** (FTDI, serie virtual) | Trama `0x7E`, etiqueta, longitud de 2 bytes (LSB primero), datos, `0xE7`. Etiqueta **6** = enviar universo DMX (byte de inicio 0 + hasta 512 canales). El aparato sigue emitiendo a su frecuencia configurada | DOC fab. S15 + TER |
| **Art-Net 4** | UDP puerto **6454**. Cabecera `"Art-Net\0"`, OpCode en *little-endian* (ArtDmx `0x5000`, ArtPoll `0x2000`, ArtSync `0x5200`), versión de protocolo 14 y datos DMX desde el byte 18 | TER S16. **Falta leer la especificación oficial** |
| **sACN (E1.31)** | Alternativa estándar (multicast UDP 5568). Dragonframe **no lo menciona** [DOC, S7] | [DED] Opcional |
| **Open DMX USB (FTDI sin microcontrolador)** | El ordenador genera el *break* y el temporizado. Poco fiable en Windows | [TER] No prioritario |

## D. Motion control: opciones para MESORA

| Opción | Descripción | Riesgo |
|---|---|---|
| **Firmware propio MESORA-Moco** (Arduino, código original) | Protocolo de texto documentado y abierto, rampas de aceleración, límites, posición absoluta y paso-mueve-paso | Ninguno legal. Recomendado como base |
| **Compatibilidad DFMoco (lado ordenador)** | Para que los rigs que ya llevan el sketch DFMoco funcionen con MESORA. Se implementa **solo** a partir de la especificación del protocolo, sin copiar el sketch | Verificar con el `DFMoco_Protocol.rtf` del usuario. La licencia del sketch es **[DESC]**: no se redistribuye |
| **DMC v2 (lado ordenador)** | Permitiría controlar dispositivos compatibles con DMC | El documento está escrito para fabricantes de dispositivos. **Revisar sus condiciones** antes de usarlo en sentido inverso |
| **Simulador** | Ejes virtuales con cinemática y registro, **identificado como simulador** en la interfaz | Necesario para las pruebas automáticas |

## E. Exportación: motor de render

- **FFmpeg** como proceso externo (no enlazado), que es lo más sencillo para cumplir la LGPL.
  - **H.264 con libx264 obliga a GPL** [S18]. Si MESORA no adopta una licencia compatible con la GPL, hay dos opciones para H.264: el codificador del sistema operativo (Media Foundation en Windows, VideoToolbox en macOS, accesibles desde FFmpeg) o el codificador de Chromium (WebCodecs/MediaRecorder, el que usa MESORA hoy [OBS]).
  - **ProRes (`prores_ks`)**, MJPEG, PNG, TIFF y WAV están en FFmpeg sin GPL [DED: verificar con `ffmpeg -L` de la compilación elegida].
- **Decisión pendiente del usuario:** la licencia de MESORA. El repositorio **no tiene licencia** [OBS].

## F. Arquitectura actual de MESORA [OBS]

- Aplicación web en JavaScript con módulos ES (unas 5.300 líneas), empaquetada con **Electron 45** (Windows, macOS y Linux) y **Capacitor** (Android). La CI de GitHub Actions genera el instalador NSIS de Windows en cada push.
- **Cámara:** solo `getUserMedia` (webcam, UVC, HDMI, réflex en modo webcam), con controles de pista (`exposureTime`, `iso`, `focusDistance`…) cuando el dispositivo los expone.
- **Almacenamiento:** **IndexedDB** dentro del perfil del navegador o de Electron. Guarda el original, la vista previa y la miniatura **como blobs en la base de datos**, no como archivos en una carpeta del proyecto.
- **Exportación:** MediaRecorder **en tiempo real** (MP4 H.264 o WebM según soporte) y ZIP de imágenes.
- **Pruebas:** 13 pruebas unitarias (grading, timing, zip) que pasan. La app arranca sin errores en Chromium headless con una cámara falsa.
- **Lo que se puede reutilizar [DED]:** visor (onion skin, diferencia, croma, peaking, histograma, guías), timeline, audio y forma de onda, deflicker, cálculo de espaciado y la interfaz en español.
- **Lo que se queda corto para un uso profesional [DED]:**
  1. Almacenamiento en IndexedDB en vez de archivos accesibles.
  2. Sin SDK de cámaras.
  3. Exportación en tiempo real con códecs limitados.
  4. Sin escenas ni tomas.
  5. Sin DMX ni motion control.
  6. Sin paneles acoplables ni segundo monitor.

## G. Pendiente y desconocido (bloqueante en su etapa)

| Tema | Bloquea | Cómo resolverlo |
|---|---|---|
| Aspecto, controles exactos y atajos de la versión instalada | Fidelidad funcional de la interfaz (etapas 5, 8–11) | Inspección directa o capturas del usuario |
| Especificación oficial de DFMoco y baudios | Compatibilidad DFMoco | `DFMoco_Protocol.rtf` del usuario |
| Puerto TCP de Simple Interface | Compatibilidad con mandos | Inspección (Scene › Connections) |
| SDK de Fujifilm y OM System | Adaptadores de esas marcas | Investigación posterior y registro |
| Licencia de MESORA | Elección de códecs de FFmpeg | Decisión del usuario |
| Cámaras y hardware reales del usuario | Pruebas con hardware real (rol «Requiere hardware») | Inventario del usuario |
