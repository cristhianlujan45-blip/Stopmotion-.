# Etapa 4 · Diseño de arquitectura

Fecha: 26-10-2026 · Estado: **propuesta pendiente de aprobación** (ver §9).

## 1. Requisitos que determinan la arquitectura

Ordenados por peso:

1. **No perder nunca un original.** La foto de la cámara llega al disco antes de que la app haga cualquier otra cosa. Después, nada la modifica ni la renombra.
2. **SDK de cámara nativos (C/C++)** de Canon, Sony y Nikon, que pueden bloquearse o colgarse. Un fallo del SDK **no puede tumbar la aplicación** ni la sesión de animación.
3. **Visor en tiempo real:** live view más onion skin, diferencia y croma a 25–30 fps sobre imágenes de 1080p–4K.
4. **Reproducción fluida** de miles de fotogramas a 24 fps.
5. **E/S de hardware** por serie (DMX USB, Arduino) y por red (Art-Net).
6. **Windows primero**, preparada para macOS y Linux, y funcionando **sin Internet**.
7. **Mantenibilidad:** el equipo real que va a mantener esto, y no romper lo que ya funciona (reglas 8 y 9 del proyecto).

## 2. Opciones evaluadas

| Criterio | A · C++ / Qt 6 nativo | B · Rust + Tauri | C · Electron + procesos nativos (evolución de MESORA) | D · Python + PyQt |
|---|---|---|---|---|
| Integración con SDK de cámara | Directa | FFI (bindgen); bien | En un proceso nativo C++ aparte (necesario en cualquier caso, ver 3.2) | ctypes/pybind; frágil |
| Aislamiento de fallos del SDK | Hay que diseñarlo igualmente (proceso aparte) | Igual | **Natural**: cada SDK en su propio proceso | Igual |
| Visor GPU en tiempo real | OpenGL/QRhi: excelente | WebView: depende del motor del sistema (WebView2, WebKit, WebKitGTK) | Chromium: WebGL2/WebGPU, WebCodecs e **idéntico en los 3 SO** | Lento si no se pasa a C++ |
| Captura UVC/HDMI | Qt Multimedia | Desigual según el WebView (WebKitGTK en Linux: limitado) | `getUserMedia` de Chromium, **ya funciona** | OpenCV |
| Docking y multimonitor | QDockWidget de serie | A medida | A medida (DOM) + `BrowserWindow` por monitor | Qt |
| Consumo de RAM | Bajo | Bajo–medio | **Alto** (≈ 250–400 MB de base) [DED] | Medio |
| Reutilizar las ~5.300 líneas actuales | 0 % | Interfaz sí; capa nativa nueva | **≈ 70 %** [DED] (visor, timeline, audio, grading y timing) | 0 % |
| Instalador de Windows | Hay que montarlo | Sí | **Ya existe** (electron-builder + CI) | PyInstaller |
| Tiempo hasta la primera versión profesional | Muy largo | Largo | **Más corto** | Largo |

**Descartadas:**
- **D:** rendimiento y empaquetado insuficientes para procesar imágenes en tiempo real.
- **B:** en Linux el WebView del sistema (WebKitGTK) tiene limitaciones de captura y vídeo, lo que rompe la meta multiplataforma, y obliga a reescribir el núcleo.

**A (C++/Qt)** es la elección «de manual» para un competidor nativo; Dragonframe es C++ desde la 3.5 [DOC]. Su coste: tirar código que funciona y multiplicar el tiempo hasta tener algo usable. Además, **no evita la parte difícil**: el aislamiento de SDK por procesos y los adaptadores son necesarios también en Qt.

## 3. Recomendación: C · Electron como interfaz + núcleo en el proceso principal + procesos nativos aislados

```
┌────────────────────────────── Proceso de interfaz (Chromium) ──────────────────────────────┐
│  Espacios: ANIMATION · CAMERA · TIMELINE · X-SHEET · AUDIO · LIGHTING · MOTION · EXPORT     │
│  Visor WebGL2 (onion, diferencia, croma, peaking, guías) · Timeline/X-Sheet (mismo modelo)  │
│  Adaptador UVC/HDMI (getUserMedia) · Web Audio · Workers (miniaturas, histogramas, IA)      │
└───────────────▲──────────────────────────────── IPC tipado (contextBridge) ────────────────┘
                │
┌───────────────┴──────────── Proceso principal (Node.js) = NÚCLEO ──────────────────────────┐
│  ProjectStore (disco, journal, recuperación) · CaptureCoordinator (cola, emparejado)        │
│  CameraHost (lanza/supervisa adaptadores) · LightingEngine (DMX) · MotionEngine            │
│  ExportEngine (lanza FFmpeg) · Scheduler de disparo (luz → movimiento → captura)            │
└──────▲─────────────────▲──────────────────▲──────────────────────▲─────────────────────────┘
       │ stdio JSON-RPC   │ serie             │ UDP                   │ proceso
┌──────┴──────┐   ┌──────┴───────┐   ┌───────┴──────┐        ┌───────┴──────┐
│ mesora-cam- │   │ ENTTEC DMX   │   │ Art-Net      │        │ ffmpeg       │
│ canon.exe   │   │ MESORA-Moco  │   │ (red)        │        │ (LGPL)       │
│ sony / nikon│   │ (Arduino)    │   └──────────────┘        └──────────────┘
│ gphoto2     │   └──────────────┘
└─────────────┘   Cada adaptador nativo: un proceso. Si cae, el núcleo lo reinicia.
```

### 3.1 Por qué cada pieza

- **Electron (interfaz):**
  - Única opción que da el mismo motor gráfico y de captura en Windows, macOS y Linux.
  - Conserva el visor, el timeline y el audio que ya funcionan, y el instalador NSIS que ya genera la CI.
  - Coste asumido: más RAM. En una estación de animación es aceptable [DED].
- **Núcleo en el proceso principal:** el acceso a disco, serie, red y procesos hijos no puede vivir en la interfaz (sandbox). Además, la interfaz puede recargarse sin interrumpir una captura en curso.
- **Un proceso nativo por SDK de cámara:**
  - Los SDK son C/C++, se ejecutan en sus propios hilos y algunos no toleran varias instancias.
  - Si un SDK se cuelga, se mata y se reinicia el proceso. La app y los originales ya escritos no se ven afectados.
  - El protocolo es **JSON-RPC por stdio**. Los fotogramas de live view (los SDK ya los entregan en JPEG) van como mensajes binarios con longitud prefijada.
  - Cada adaptador se compila **solo si el SDK está presente** en la máquina de compilación. La app se ejecuta y se distribuye sin ellos.
- **FFmpeg como proceso externo:** codificación fuera de tiempo real (cada fotograma de animación es un fotograma de vídeo exacto) y todos los códecs profesionales (ProRes, MJPEG, PNG/TIFF, WAV). Ejecutarlo como proceso separado simplifica el cumplimiento de la LGPL. El H.264 depende de la licencia elegida (ver §9).
- **Serie y red en Node:** `serialport` (módulo nativo, con prebuilds para Electron) para ENTTEC y Arduino, y `dgram` para Art-Net. Web Serial en la interfaz es la alternativa si se quiere evitar módulos nativos [DOC, Electron].

### 3.2 Contrato de adaptador de cámara

```js
/** Lo que el núcleo exige a cualquier fuente de cámara. */
interface CameraAdapter {
  id: string;                  // 'uvc' | 'canon-edsdk' | 'sony-crsdk' | 'nikon' | 'gphoto2' | 'folder-watch' | 'simulator'
  kind: 'real' | 'simulator';  // el simulador se muestra SIEMPRE rotulado en la interfaz
  listDevices(): Promise<DeviceInfo[]>;
  open(deviceId): Promise<Capabilities>;          // live view, propiedades, formatos, RAW…
  close(): Promise<void>;
  startLiveView(onFrame: (jpegOrBitmap, meta) => void): Promise<void>;
  stopLiveView(): Promise<void>;
  getProperties(): Promise<Property[]>;           // iso, aperture, shutter, wb, focus… tipadas, con valores permitidos
  setProperty(name, value): Promise<Property>;    // devuelve el valor que la cámara confirma realmente
  capture(req: { frameId, exposure }): Promise<CapturedFile[]>; // se resuelve cuando el archivo está COMPLETO y sincronizado en disco
  on(event: 'disconnected' | 'reconnected' | 'error', cb): void;
}
```

Una **batería de pruebas de contrato** común (abrir, live view, captura, desconexión) la deben pasar todos los adaptadores. El simulador la pasa en CI. Los adaptadores reales la pasan en un banco con la cámara, y el resultado se registra en `docs/pruebas/`.

### 3.3 Datos en disco (diseño propio)

```
MiCorto.mesora/                        ← producción (una carpeta: se ve en el Explorador)
  production.json                      ← nombre, fps, resolución, personajes, perfiles
  journal/000001.jsonl                 ← diario de operaciones (append-only, fsync)
  scenes/
    sc010/scene.json                   ← ajustes, plantilla, longitud, notas
      takes/
        tk01/
          edl.json                     ← lista de edición VIRTUAL (orden, holds, tags, notas por fotograma)
          capture/X1/sc010_tk01_X1_c000001.CR3   ← ORIGINALES, inmutables, numerados por orden de CAPTURA
          capture/X1/sc010_tk01_X1_c000001.JPG
          assist/sc010_tk01_a000001.jpg          ← video assist emparejado
          proxy/…                                ← vistas previas para reproducción (regenerables)
          trash/                                 ← lo «borrado» (se recupera; solo se vacía a mano)
  audio/  references/  characters/<nombre>/faces/  lighting/  motion/  exports/
```

- **Los originales nunca se renombran ni se sobrescriben.** El orden final vive en `edl.json`. El **conform** produce una copia renumerada en `exports/`.
- **Escritura segura:**
  1. Se escribe en `*.partial` dentro del mismo directorio.
  2. Se hace `fsync` y luego `rename`.
  3. Se anota en el journal.
  4. La EDL se actualiza.

  Al arrancar se repite el journal desde el último snapshot y se listan los `*.partial` y los archivos sin entrada como **huérfanos recuperables**; nunca se borran automáticamente.
- **¿Por qué JSON + journal y no SQLite como primera opción?** Es legible, se puede inspeccionar con cualquier editor, no necesita módulo nativo y su tamaño encaja con el volumen de datos: una toma de 10.000 fotogramas ocupa ≈ 1–2 MB de EDL [DED]. Se reserva SQLite para un catálogo global de producción (búsqueda e IA) si más adelante hace falta.
- **Migración:** un importador convierte los proyectos actuales (IndexedDB y `.mesora`) a este formato. Los proyectos antiguos no se tocan.

### 3.4 Disparo coordinado (orden por fotograma)

`luz de exposición (DMX) → mover ejes y esperar «en posición» → asentamiento → capturar assist → capturar HQ → esperar archivo completo → luz de trabajo → avanzar`

Cada paso tiene un tiempo límite y un error explícito. **No se avanza de fotograma sin el archivo confirmado en disco.**

## 4. Módulos y responsabilidades (sin duplicar)

| Módulo | Proceso | Reutiliza de MESORA |
|---|---|---|
| `core/project` (ProjectStore, EDL, journal, recuperación, conform) | principal | modelo de `app.js`/`projectio.js` (lógica), no IndexedDB |
| `core/capture` (cola, emparejado assist/HQ, exposiciones) | principal | cola de `app.js` |
| `camera/*` adaptadores + `camera-host` | principal + nativos | `camera.js` → adaptador `uvc` |
| `viewer` (WebGL2) | interfaz | `viewer.js` (portado de Canvas2D a shaders donde haga falta) |
| `timeline`, `xsheet` (vistas del mismo modelo) | interfaz | `timeline.js`, `timing.js`, `history.js` |
| `audio`, `lipsync` | interfaz | `audio.js` |
| `lighting` (perfiles, keyframes, drivers ENTTEC/Art-Net, simulador) | principal + interfaz | nuevo |
| `motion` (ejes, curvas, driver MESORA-Moco/DFMoco, simulador) + `firmware/mesora-moco` | principal + Arduino | nuevo |
| `automation` (curvas por fotograma, compartidas por luz y movimiento) | compartido | nuevo |
| `export` (FFmpeg, secuencias, CSV, metadatos) | principal | `exporter.js`, `zip.js` |
| `assist` (IA opcional: duplicados, golpes, exposición) | Workers | `grading.js` (luma) |
| `ui/shell` (espacios de trabajo, docking, atajos, multimonitor) | interfaz | estilos y componentes actuales |

Android (Capacitor) se mantiene con el código de interfaz común y almacenamiento propio. **No es objetivo** de las funciones de hardware.

## 5. Pruebas

- **Unitarias** (`node --test`): EDL, journal y recuperación (con muerte simulada del proceso), interpolación de curvas, codificación DMX (ENTTEC y Art-Net byte a byte), protocolo MESORA-Moco y conform.
- **Contrato de adaptadores:** simulador en CI; adaptadores reales en banco, con registro.
- **Integración en Electron** (Playwright `_electron`): capturar 50 fotogramas con cámara falsa, editar, cerrar, reabrir, exportar y verificar con `ffprobe` el número exacto de fotogramas y la duración.
- **Prueba de no pérdida:** 1.000 capturas con matados aleatorios del proceso → 0 originales perdidos o corruptos (hash).
- **Rendimiento:** reproducción a 24 fps con 2.000 fotogramas de 1080p sin caídas (medido con `requestAnimationFrame`).

## 6. Plan por etapas (cada una deja una versión instalable y comprobable)

| Etapa | Entrega comprobable | Criterio de salida |
|---|---|---|
| 6 · Motor principal | Proyectos en disco (producción › escena › toma), journal, papelera, conform, migración desde IndexedDB | Prueba de no pérdida + migración de un proyecto actual |
| 7 · Cámara | `camera-host`, adaptadores `uvc`, `folder-watch` y `simulator`; video assist + HQ emparejados; adaptador `canon-edsdk` **en cuanto haya SDK** | Contrato de adaptador; captura real con carpeta vigilada |
| 8 · Animación | Visor WebGL2 (onion bidireccional, modos de mezcla, guías vectoriales, capas de referencia) | Pruebas de píxel del visor |
| 9 · Timeline y X-Sheet | Insertar/sobrescribir, hold, portapapeles, entrada y salida, tags, X-Sheet con columnas y CSV | Las dos vistas sincronizadas; CSV de ida y vuelta |
| 10 · Audio y lip sync | Varias pistas, personajes, face sets (PSD o carpeta), track reading, HUD | Lectura sincronizada al fotograma |
| 11 · Luz y movimiento | Automatización compartida, ENTTEC/Art-Net, firmware MESORA-Moco, simuladores rotulados | Bytes validados; banco con Arduino (si lo hay) |
| 12 · Proyectos y exportación | FFmpeg: MP4/MOV/AVI/PNG/JPEG/TIFF/WAV, resoluciones, metadatos | Validación con `ffprobe` |
| 13 · IA | Duplicados, golpes de cámara, saltos de exposición, informes | Precisión sobre un conjunto de prueba |
| 14–15 · Integración y entrega | Pruebas integrales, instalador firmado (si hay certificado), manuales | Registro de pruebas completo |

**Espacios de trabajo e interfaz (etapa 5)** se desarrollan en paralelo a la 6: primero el *shell* (docking, atajos, multimonitor) y luego cada espacio a medida que su módulo funciona. Así no hay botones decorativos: un control solo aparece cuando su función existe.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Sin acceso a los SDK de marca | Carpeta vigilada + HDMI como vía real desde el día 1. Adaptadores listos para compilar cuando el usuario tenga el SDK |
| SDK que no se puede redistribuir | El adaptador carga la DLL instalada por el usuario o la empaqueta el usuario en su propia compilación. Revisar cada licencia |
| Rendimiento del visor a 4K | Mostrar en pantalla la vista previa (≤ 2K) y usar el original solo para la lupa 1:1 |
| Sin hardware para verificar DMX y motion control | Validación a nivel de bytes y simulador. La función queda en «Requiere hardware» hasta probarla en un banco real |
| Diferencias con el comportamiento real de Dragonframe | Inspección directa pendiente (etapa 1) |

## 8. Lo que **no** se hará

- Copiar código, recursos, iconos, nombres de archivo o formatos propietarios de Dragonframe. El formato `.dgn` no se lee ni se escribe salvo que el usuario lo pida expresamente y sea legal en su jurisdicción.
- Sortear la activación o las protecciones de Dragonframe.
- Simular una cámara o un aparato sin rotularlo como simulador.

## 9. Decisiones que necesita tomar el usuario

1. **Arquitectura:** C (evolucionar MESORA, recomendada) o A (reescritura en C++/Qt).
2. **Licencia de MESORA** (el repo no tiene ninguna):
   - Compatible con la GPL: permite usar libx264 para H.264.
   - Propietaria o permisiva: H.264 mediante el codificador del sistema operativo o el de Chromium.
3. **Cámara y hardware reales** con los que se va a producir. Fija el orden de los adaptadores: Canon EDSDK primero salvo que se indique otra cosa.
4. **Registro en los programas de SDK** (Canon, Sony, Nikon): lo tiene que hacer el usuario o su organización.
