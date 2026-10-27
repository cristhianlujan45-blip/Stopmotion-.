# Etapa 3 · Matriz de equivalencia Dragonframe ↔ MESORA

Fecha: 26-10-2026, actualizada el 27-10-2026 · Versión de MESORA evaluada: 1.0.0 + fases 1–10 de la auditoría.

## Cómo leer la matriz

**Estados** (los que pide el proyecto):

| Estado | Criterio |
|---|---|
| No iniciada | No hay código |
| En desarrollo | Hay trabajo en curso, pero no se puede usar |
| Parcialmente implementada | Hay código en MESORA que cubre parte de la función. **No se ha verificado de principio a fin** en esta revisión, o no tiene paridad con Dragonframe |
| Implementada | Cubre la función, pero falta la verificación formal |
| Probada y verificada | Supera la prueba de aceptación indicada, ejecutada y registrada en `docs/pruebas/` |
| Requiere hardware | No se puede verificar sin un dispositivo físico |
| Requiere SDK externo | Necesita un SDK de fabricante que el usuario debe obtener |

Una función puede tener dos estados, por ejemplo «Parcial + Requiere SDK».

**Fuentes de la columna Dragonframe:** referencias de `02-investigacion-tecnica.md` (S1 = manual DF4, S2 = página de funciones, S3 = historial de versiones…).

> Hasta la inspección directa, ninguna fila de Dragonframe es **[OBS]**. «Probada y verificada» solo se usa cuando la prueba de aceptación se ha ejecutado y está registrada en `docs/pruebas/`.

---

## 1. Núcleo, proyecto y archivos

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 1.1 | Producción › escena › toma | Escena = carpeta + `.dgn`; tomas dentro [S1 p. 9, 149] | **Escritorio:** carpetas en `Documentos/MESORA` (etapa 6). Web/Android: proyectos planos | Probada y verificada | Implementado en `electron/core/library.cjs` | Proceso principal de Electron, `fs` | Pasa: estructura en disco, reabrir y crear nuevas tomas y escenas (pruebas: `tests/library.test.js`, `tests/e2e/desktop.e2e.cjs`) |
| 1.2 | Originales como archivos accesibles | Carpetas de exposición `X1…Xn` con nombres legibles [S1 p. 335] | `capture/X1/sc010_tk01_X1_c000001.jpg`, inmutables | Probada y verificada | Escritura `.partial` + `fsync` + `link()` sin sobrescribir | `fs` | Pasa: hash idéntico al recibido; nunca se sobrescribe; numeración continua tras reabrir |
| 1.3 | Edición virtual + conform | Las ediciones no tocan los archivos; *conform* renumera [S1 p. 335] | `edl.json` + conform a `exports/` | Probada y verificada | Lista de edición virtual; conform = copia renumerada con holds | JSON atómico | Pasa: conform en orden con holds; hashes de los originales sin cambios |
| 1.4 | Papelera de fotogramas | Carpeta `_backup` con lo borrado; restaurar [S1 p. 133, 335] | Papelera virtual (capturas fuera del timeline) + botón «Papelera» | Probada y verificada | Borrar = quitar del timeline; el original no se mueve | — | Pasa: borrar, cerrar, reabrir y restaurar (núcleo y E2E) |
| 1.5 | Guardado automático | Continuo [DED] | Escritorio: a disco 400 ms después de cada cambio; web: IndexedDB | Probada y verificada | JSON atómico por nivel (producción, escena, toma) | `fs` + fsync | Pasa: el disco refleja capturas, borrados y restauraciones (E2E) |
| 1.6 | Recuperación ante fallos | [DESC] | Capturas huérfanas → al final con nota; `.partial` informados y conservados; originales que faltan, avisados | Probada y verificada | Lista `known` + reconciliación al abrir | — | Pasa: 80 rondas de `SIGKILL` en mitad de capturas y guardados, 0 capturas confirmadas perdidas o duplicadas |
| 1.7 | Duplicar escena | Sí [S1 p. 152] | «Duplicar escena», «Nueva toma», «Nueva escena» en Proyectos (menú ⋯) | Implementada | Copia completa (originales con `COPYFILE_EXCL`/clonado CoW) | `fs.copyFile` | Núcleo probado (la copia es independiente); «Nueva toma» probada en E2E; duplicar escena y nueva escena aún sin E2E |
| 1.8 | Plantillas e importar ajustes de escena | Sí [S1 p. 156–157] | Una escena nueva copia los ajustes de otra; las tomas comparten los de su escena | Parcial | Faltan plantillas guardadas con nombre | — | Nueva escena desde plantilla con cámara, fps y guías iguales |
| 1.9 | Importar imágenes | Importar secuencia (DF3.6) [S1 p. 154] | Sí (arrastrar); en escritorio se guardan los bytes originales | Implementada | Copia a la toma conservando los bytes | — | Importar 500 JPEG/PNG/TIFF: orden y bytes correctos (prueba pendiente) |
| 1.10 | Exportar/importar proyecto completo | Carpetas directas | La producción *es* una carpeta; `.mesora` sigue funcionando a través de la nueva capa | Implementada | — | — | Ida y vuelta entre dos equipos sin pérdida (prueba pendiente) |
| 1.11 | Notas de escena (Notepad) | Notepad y notas por fotograma (DF4.1) [S1 p. 209] | Notas por fotograma | Parcial | Notas de escena y por fotograma en el modelo | — | Las notas aparecen en el X-Sheet y en la exportación CSV |
| 1.12 | Frame Tags | Etiquetas de fotograma (DF5.2); reproducir y exportar por tags (2025.09/2026.01) [S3] | No | No iniciada | Etiquetas en la EDL | — | Reproducir y exportar solo los fotogramas etiquetados |
| 1.13 | Historial del timeline | [DESC] | Versión antes de cada borrado + una por minuto; botón «Historial» | Probada y verificada | `history/edl-*.json` (máx. 50) | — | Pasa: restaurar una versión anterior (núcleo y E2E) |
| 1.14 | Migración desde la versión anterior | — | Proyectos de IndexedDB → carpetas al arrancar la app de escritorio | Probada y verificada | Copia completa; marcada solo al terminar; sin tocar el original | — | Pasa: orden, holds, notas y audio conservados; no se repite (E2E) |

## 2. Cámara y captura

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 2.1 | Capa de adaptadores de cámara | Múltiples fuentes de captura [S1 p. 39–50] | Una única clase `Camera` (getUserMedia, o el móvil por WebRTC) | No iniciada | Interfaz `CameraAdapter` + registro de adaptadores (ver arquitectura) | — | Las pruebas del contrato pasan para cada adaptador |
| 2.2 | Webcam / UVC / capturadora HDMI | Soportado | Sí, hasta 4K | Parcial | Adaptador `uvc` (código actual migrado) | Chromium `getUserMedia` | Live view ≥ 25 fps a 1080p; captura PNG sin pérdida |
| 2.3 | Canon EOS (réflex y sin espejo) | Recomendado; live view y captura [S8] | No | Requiere SDK | Adaptador `canon-edsdk` en un proceso nativo separado | EDSDK (registro en Canon), C++ | Live view, captura RAW+JPEG a disco, cambio de ISO/apertura/obturación, desconexión y reconexión |
| 2.4 | Sony α | Soportado (modelos limitados) [S8] | No | Requiere SDK | Adaptador `sony-crsdk` | Camera Remote SDK | Igual que 2.3 |
| 2.5 | Nikon | Soportado [S8] | No | Requiere SDK | Adaptador `nikon-maid` | Nikon SDK por modelo | Igual que 2.3 |
| 2.6 | Fujifilm, OM System | Soportado [S8] | No | Requiere SDK | Adaptadores posteriores | SDK [DESC] | Igual que 2.3 |
| 2.7 | Linux/macOS: libgphoto2 | — | No | No iniciada | Adaptador `gphoto2` (no aplica a Windows) | libgphoto2 (LGPL) | Igual que 2.3 en Linux |
| 2.8 | Carpeta vigilada | *Folder watching* [S2] | Sí: carpeta del programa del fabricante (EOS Utility, NX Tether, Imaging Edge…), espera a que el archivo termine de escribirse, RAW+JPEG como una sola captura, copia sin mover | Implementada + Requiere hardware | Vigilar la carpeta del tethering del fabricante y asignar cada archivo al fotograma pendiente | `fs.watch` + escritura estable | Pasa con archivos que imitan la escritura por partes de un programa de tethering (E2E `tests/e2e/desktop.e2e.cjs`, `tests/camera.test.js`). Falta la prueba con una cámara real |
| 2.9 | Video assist + alta calidad en paralelo | Dos secuencias sincronizadas [S1 p. 1–2] | Sí: con la carpeta vigilada y una webcam o capturadora a la vez, cada foto guarda también su imagen de vídeo; el visor puede mostrar una u otra | Probada y verificada | Fuente de vista ≠ fuente de captura, emparejadas por fotograma | — | Pasa: assist guardado junto a la foto y visor alternable (E2E `tests/e2e/desktop.e2e.cjs`) |
| 2.10 | ISO, apertura, obturación, balance de blancos | Controles gráficos [S2] | Controles de pista cuando la webcam los expone | Parcial | Propiedades genéricas tipadas por adaptador | SDK | El valor leído después de escribir coincide con el de la cámara |
| 2.11 | Enfoque y comprobación de foco | Focus check, punch-in, peaking [S2; S3] | Peaking y lupa 1:1 | Parcial | Enfoque por SDK cuando exista; peaking en GPU | WebGL2 | Mover el foco por pasos desde la app (si el SDK lo permite) |
| 2.12 | Histograma, recortes y densitómetro | Sí [S2] | Histograma RGB con aviso de recorte | Parcial | + densitómetro en un punto y vista de recortes | WebGL2/Worker | Comparar con una imagen sintética de valores conocidos |
| 2.13 | Tomas de prueba y comparación A/B | Sistema de test shots [S2] | Foto de prueba fuera de la animación y comparación A/B (prueba a la derecha, vivo a la izquierda) | Implementada | Tomas de prueba fuera de la secuencia + comparador A/B | — | Las tomas de prueba no aparecen en el timeline ni en la exportación |
| 2.14 | Exposiciones múltiples (X1…X12) | Hasta 12 por toma, cada una con sus ajustes [S1 p. 9, 94] | Promediado de ruido (otra función) | No iniciada | Exposiciones con perfil de cámara y DMX propios | — | 3 exposiciones por fotograma en el orden correcto |
| 2.15 | Promediado de vídeo | *Video frame averaging* [S2] | Sí (2–16 cuadros) | Parcial | Se conserva | — | Reducción del ruido medida en un patrón |
| 2.16 | Disparo por teclado, botón y mando | Keypad, Bluetooth, Simple Interface [S2; S4] | Teclado, botón, **móvil como mando por wifi** y **API local HTTP** para otros programas | Probada y verificada | + mando por serie/TCP y gamepad | Web Serial / `net` | Pasa: captura y navegación pedidas por la API con código de acceso; sin código, 403 (`tests/remote.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 2.17 | Captura en cola y bloqueo | Captura a disco inmediata [S1 p. 3] | Cola de capturas | Parcial | Cola por adaptador con confirmación del archivo escrito | — | 10 disparos rápidos: 10 archivos, ninguno perdido |
| 2.18 | Detección de desconexión y reconexión | [DESC] | Reconexión automática al perder la señal | Probada y verificada | Monitor de estado + reconexión automática sin perder el fotograma pendiente | — | Pasa: la cámara se reconecta sola tras perder la señal (E2E `tests/e2e/desktop.e2e.cjs`) |
| 2.19 | Ajustes por escena y bloqueo de exposición | Sí [S2] | Bloquear automáticos, recordar por cámara | Parcial | Perfil de cámara por escena y exposición | — | Reabrir la escena reaplica los ajustes |
| 2.20 | Intervalómetro / time-lapse | Sí [S1 p. 145] | Sí | Parcial | Se conserva, integrado con la cola | — | 100 disparos a 2 s con desviación < 50 ms |
| 2.21 | Multicámara | Hasta 8 (DF5.2) [S3] | No | No iniciada | Varias instancias de adaptador | — | 2 webcams capturando a la vez en exposiciones distintas |
| 2.22 | Captura *making-of* | DF5.0 [S3] | No | No iniciada | Segunda fuente grabando en segundo plano | — | — |
| 2.23 | Móvil como cámara inalámbrica | **[DESC]**: no aparece en las fuentes revisadas | Sí (escritorio): QR, página https del móvil con certificado propio, imagen en vivo por WebRTC en la red local ajustada para no acumular retraso, fotos a resolución completa codificadas en el móvil (JPEG o PNG) por canal de datos, controles de cámara que el navegador del móvil exponga, pantalla del móvil en negro, reconexión sola | Implementada + Requiere hardware | `js/phonecam.js`, `electron/remote/camera.html`, `electron/core/cert.cjs` | WebRTC, `https` de Node | Pasa con otro navegador haciendo de móvil en el mismo ordenador: 1080p desde el primer segundo, foto 1920 × 1080 en JPEG y PNG sin recomprimir, retardo móvil → pantalla de 39–40 ms de mediana (p95 ≤ 63 ms) (E2E `tests/e2e/desktop.e2e.cjs` sección 21, `tests/cert.test.js`, `tests/remote.test.js`). Falta la prueba con un móvil real por wifi |

## 3. Herramientas de animación y visor

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 3.1 | Onion skin (opacidad, último sobre vivo) | Deslizador bidireccional [S1 p. 121] | 1–6 fotogramas, opacidad, modos de mezcla | Implementada | Deslizador bidireccional (vivo↔fotograma) | WebGL2 | Mezcla exacta en píxel comprobada con imágenes de prueba |
| 3.2 | Varios fotogramas, colores diferenciados | Hasta 5 fotogramas [S1 p. 123] | Anteriores y siguientes, tinte rojo/verde opcional | Probada y verificada | Tinte anterior/siguiente y caída de opacidad | WebGL2 | Pasa: tinte de papel cebolla comprobado en píxel (`tests/e2e/viewer.e2e.cjs`) |
| 3.3 | Modo diferencia | Sí [S1 p. 122] | Sí (`D`), en GPU y en 2D | Probada y verificada | Se conserva, en GPU | WebGL2 | Pasa: imágenes iguales → negro; distintas → diferencia exacta (`tests/e2e/viewer.e2e.cjs`) |
| 3.4 | Claros y oscuros prominentes (Frame Echo) | Sí [S1 p. 122] | Mezclas «destacar lo claro» y «destacar lo oscuro» | Probada y verificada | Mezcla *lighten* y *darken* en shader | WebGL2 | Pasa: valores de píxel exactos (`tests/e2e/viewer.e2e.cjs`) |
| 3.5 | Alternar vivo / último y auto toggle | Sí [S2] | `2` y `B` (parpadeo) | Parcial | Se conserva | — | — |
| 3.6 | Capturar, duplicar, eliminar, insertar, reemplazar | Sí [S1 cap. 8] | Sí | Parcial | Operaciones sobre la EDL (ver 1.3) | — | Batería de operaciones con el resultado esperado de la EDL |
| 3.7 | Hold / exposición múltiple de un cuadro | Hold, *virtual holds* [S1 p. 117, 134] | Duración por fotograma y `Ctrl+2…9` (captura que dura N cuadros) | Probada y verificada | Hold en la EDL; «Shoot Multiple» | — | Pasa: `Ctrl+3` → un fotograma de 3 cuadros (E2E `tests/e2e/desktop.e2e.cjs`) |
| 3.8 | Deshacer / rehacer | Sí | Ilimitado en memoria | Parcial | Deshacer persistente vía journal | — | Deshacer después de reiniciar |
| 3.9 | Guías de composición, rejillas y máscaras | Aspect mask, TV-safe, push-in mask, rejillas [S2] | Rejillas, máscaras de aspecto, zonas seguras | Parcial | + máscara de *push-in*; guías alternativas | Canvas/WebGL | — |
| 3.10 | Capas de dibujo y guías vectoriales | Drawing layers, Guide layers, editor de incrementos [S1 p. 59; S2] | Capa de guías a mano | Parcial | Capas vectoriales múltiples + editor de incrementos (espaciado) | SVG/Canvas | Las guías nunca aparecen en la captura ni en la exportación |
| 3.11 | Líneas de movimiento / trayectorias | Increment editor, marcadores de trayectoria [S2] | Calculadora de espaciado | Parcial | Trayectoria con marcas de espaciado dibujadas en la vista | — | — |
| 3.12 | Rotoscopia y referencias superpuestas | Roto layers, media layers, varias referencias [S1 p. 63, 124] | Una referencia (vídeo o imagen) | Parcial | Varias capas de medio con transformación y opacidad | — | Referencia sincronizada al fotograma ±0 |
| 3.13 | Croma / pantalla verde | Chromakey y garbage matte [S2] | Croma en tiempo real + fondo | Parcial | + garbage matte | WebGL2 | — |
| 3.14 | Punch-in (lupa del live view) | Live View Mag [S2] | Lupa 1:1 | Parcial | Zoom del sensor por SDK si existe | SDK | — |
| 3.15 | Monitor auxiliar / segundo monitor | Sí [S2] | Segunda pantalla: el visor en otra ventana, a pantalla completa en el monitor externo | Probada y verificada | Ventana secundaria de Electron con la vista | `BrowserWindow` | Pasa: la segunda ventana recibe la imagen del visor (E2E `tests/e2e/desktop.e2e.cjs`) |
| 3.16 | Atajos configurables | Sí [S2] | Atajos editables en Ayuda, guardados y restablecibles | Probada y verificada | Mapa de atajos editable y exportable | — | Pasa: tecla reasignada funciona (`tests/shortcuts.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 3.17 | Calculadora de espaciado | (Increment editor) | Sí (lineal/ease) | Parcial | Se conserva | — | Pruebas unitarias existentes |
| 3.18 | Deflicker / estabilizar luz | No es una función destacada de DF [DED] | Sí | Parcial | Se conserva (función diferencial de MESORA) | — | Pruebas unitarias existentes |

## 4. Timeline y X-Sheet

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 4.1 | Miniaturas y navegación | Sí [S1 p. 131] | Sí | Parcial | Virtualizado para más de 10.000 fotogramas | — | Desplazamiento fluido con 10.000 fotogramas |
| 4.2 | Arrastrar: insertar o sobrescribir | Marcadores amarillo/rojo, arrastre lateral [S1 p. 133–134] | Reordenar arrastrando | Parcial | Las dos semánticas documentadas | — | Casos de la EDL |
| 4.3 | Cortar, copiar, pegar (también inverso) | Sí [S1 p. 135] | Duplicar y eliminar | Parcial | Portapapeles de fotogramas | — | — |
| 4.4 | Marcadores, entrada/salida, Nav-Line | `I`/`O`, más allá de lo rodado [S1 p. 116] | Rango seleccionado | Parcial | Puntos de entrada y salida + marcadores con nombre | — | — |
| 4.5 | FPS 8, 10, 12, 15, 18, 24, 25, 30 y personalizado | FPS del proyecto + velocidad de reproducción temporal [S1 p. 116] | 6–30 fps, 18 y personalizado; velocidad de revisión separada (1, ½, ¼) | Implementada | Añadir 18 y personalizado; separar FPS del proyecto y de reproducción | — | Reproducción a 24 fps: deriva < 1 fotograma en 10 min |
| 4.6 | Reproducción fluida en alta resolución | Proxies `hq` en RAM [S1 p. 335] | Visor WebGL2 con vista previa 1080p y caché por bytes | Implementada | Proxies en disco + caché + decodificación en Worker | `createImageBitmap`, Workers | 24 fps sin saltos con 2.000 fotogramas a 1080p |
| 4.7 | Bucle, ping-pong, short play | Sí [S2] | Sí | Parcial | Se conserva | — | — |
| 4.8 | X-Sheet sincronizado | Columnas y marcas X/C, edición desde la hoja [S1 cap. 11] | Vista X-Sheet virtualizada sobre el mismo modelo que el timeline | Probada y verificada | Vista X-Sheet independiente sobre el **mismo** modelo que el timeline | — | Pasa: el plan sigue en su exposición aunque cambien los fotogramas (E2E `tests/e2e/desktop.e2e.cjs`, `tests/xsheet.test.js`) |
| 4.9 | Columnas: diálogo, fonemas, cámara, luz, notas, acción | Sí [S1 cap. 11] | Acción, diálogo, fonema, cámara, luz y notas | Probada y verificada | Columnas tipadas + columnas personalizadas | — | Pasa: se guarda en la escena y se exporta (E2E `tests/e2e/desktop.e2e.cjs`) |
| 4.10 | Longitud de escena y fotograma inicial | 48 por defecto, crece [S1 p. 190] | Longitud de la escena en exposiciones (48 por defecto) | Implementada | En los ajustes de escena | — | — |
| 4.11 | Imprimir y exportar CSV | Sí [S1 p. 201–203] | Exportar e importar CSV, imprimir | Probada y verificada | Exportar CSV + impresión/PDF | `webContents.printToPDF` | Pasa: CSV con lo planificado y reimportable (`tests/xsheet.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |

## 5. Audio y Lip sync

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 5.1 | Importar WAV y MP3 | Sí [S1 p. 162] | Varios archivos a la vez como pistas | Implementada | Se conservan los archivos originales | Web Audio | — |
| 5.2 | Varias pistas | Multi-track [S2] | Pistas con nombre, volumen, silencio y exposición de inicio; mezcla al reproducir, al recorrer y al exportar | Probada y verificada | Pistas con desfase, recorte y mute | Web Audio | Pasa: 2 pistas, una silenciada y otra desplazada: la mezcla WAV suena donde debe (E2E `tests/e2e/desktop.e2e.cjs`) |
| 5.3 | Forma de onda, scrub | Sí [S1 p. 162] | Sí | Parcial | Picos precalculados (multirresolución) | Worker | — |
| 5.4 | Recortar, mover, exportar pista editada | Sí [S1 p. 163–166] | Desplazar, volumen y silencio; exportar la mezcla del tramo | Parcial | Edición no destructiva | — | — |
| 5.5 | Time-Warp (audio sincronizado a otra velocidad) | Sí [S2] | Velocidad de revisión con el sonido acompasado (`playbackRate`) | Implementada | Reproducción del audio acompasada a la velocidad | Web Audio `playbackRate` | — |
| 5.6 | Personajes y face sets | Face sets en PSD multicapa, personajes [S1 p. 171–175] | Personajes con biblioteca de 9 bocas (imágenes sueltas, sin PSD) | Implementada | Biblioteca propia: carpeta de imágenes o PSD (lectura de capas) | Lector PSD (p. ej. `ag-psd`) | Cargar un PSD de 10 bocas → 10 formas |
| 5.7 | Track reading (fonemas por fotograma) | Fila por personaje con cues [S1 p. 175–182] | Columna «Fonema» por exposición; acepta la boca o la letra; borrador desde el diálogo | Probada y verificada | Pista de fonemas por personaje y fotograma | — | Pasa: reposo, labios cerrados antes de hablar y boca abierta al hablar (`tests/lipsync.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 5.8 | Marcadores de audio | Sí, `Ctrl+flechas` [S1 p. 182] | No | No iniciada | — | — | — |
| 5.9 | HUD de boca en Animation | Sí [S1 p. 182] | La boca (imagen y nombre) de la exposición que se rueda o se revisa | Probada y verificada | HUD con la forma de boca | — | Pasa: en vivo muestra la boca «A» del personaje (E2E `tests/e2e/desktop.e2e.cjs`) |
| 5.10 | Exportar/importar lectura; time remap para After Effects | Sí [S1 p. 183–185] | No | No iniciada | Formatos de texto abiertos (p. ej. Papagayo MOHO `.dat`) [DED] | — | — |
| 5.11 | Lectura automática de fonemas | No documentada en DF [DED] | Borrador por volumen (no reconoce palabras), solo rellena celdas vacías | Parcial | Opcional (etapa IA): sugerencia de fonemas desde el audio | Modelo local [DESC] | Siempre como sugerencia editable |

## 6. Iluminación (DMX)

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 6.1 | Salida ENTTEC DMX USB Pro | Soportado [S7] | Paquete «Send DMX» (label 6) por Web Serial | Implementada + Requiere hardware | Driver de serie, etiqueta 6 | `serialport` (nativo) o Web Serial | Formato del paquete comprobado (`tests/rig.test.js`); falta probar con el aparato |
| 6.2 | Salida Art-Net | Soportado [S7] | Emisor ArtDmx por UDP 6454 (escritorio) | Probada y verificada | Emisor ArtDmx por UDP | `dgram` | Pasa: paquetes recibidos y validados en un socket de este mismo ordenador (`tests/rig.test.js`, E2E `tests/e2e/desktop.e2e.cjs`); sin luces reales |
| 6.3 | Canales, intensidad, RGB, temperatura de color | Perfiles de luz [S1 p. 225] | Luces con canal e intensidad 0–100 % | Parcial | Perfiles de aparato (canales → atributos) | — | — |
| 6.4 | Keyframes por fotograma + curvas | Keyframes con Bézier, tabla [S1 p. 216–221; S2] | Looks y claves por exposición con fundido lineal | Probada y verificada | Pista de automatización por canal o grupo | — | Pasa: niveles interpolados exactos por exposición (`tests/rig.test.js`); faltan curvas Bézier |
| 6.5 | Grupos, filtros, guardar y cargar canal | Sí [S1 p. 222–225] | No | No iniciada | — | — | — |
| 6.6 | Programas por exposición | Sí [S1 p. 231] | No | No iniciada | Requiere 2.14 | — | — |
| 6.7 | Bash light (luz de trabajo) | Sí [S1 p. 229] | No | No iniciada | Escena de luz «trabajo» automática entre disparos | — | — |
| 6.8 | Perfiles por escena y repetir | Sí | Luces, looks y programa guardados en cada escena | Implementada | En los ajustes de escena | — | — |
| 6.9 | Simulador DMX | — | Simulador con la vista de cada luz, rotulado | Probada y verificada | Visualizador de universo, **marcado como simulador** | — | Pasa (E2E `tests/e2e/desktop.e2e.cjs`) |

## 7. Motion control

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 7.1 | Arduino + paso a paso (shoot-move-shoot) | DFMoco 4–8 ejes [S6] | Firmware propio MESORA-Moco (Arduino, STEP/DIR, rampa trapezoidal) + host; move · shoot · move | Implementada + Requiere hardware | Firmware propio **MESORA-Moco** + host | Arduino, `serialport` | Firmware compilado con el compilador del sistema y ejecutado con un Arduino simulado (`tests/firmware.test.js`); host con el simulador ({E2E}). Falta la placa con motores |
| 7.2 | Compatibilidad DFMoco | Protocolo en `.rtf` [S6] | No | No iniciada | Driver de host según la especificación oficial (pendiente) | — | Decisión: MESORA usa su propio protocolo abierto (`docs/luz-y-movimiento.md`) |
| 7.3 | Ejes: pan, tilt, dolly, slider, foco o zoom | Arc [S1 cap. 14] | Ejes con nombre, unidad y pasos por unidad (sin finales de carrera) | Implementada | Ejes configurables (unidades, pasos/unidad, límites) | — | — |
| 7.4 | Keyframes y curvas por eje | Sí [S1 p. 249] | Claves por eje y exposición con curvas (constante, acelerar, frenar…) y gráfica | Probada y verificada | Pista de automatización (compartida con DMX) | — | Pasa: posición por exposición = curva evaluada (`tests/rig.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 7.5 | Velocidad, aceleración, límites | Sí [S2] | Velocidad y aceleración configurables; rampa trapezoidal en el firmware | Implementada + Requiere hardware | Rampas trapezoidales en el firmware | — | Rampa y límite de velocidad comprobados en el Arduino simulado |
| 7.6 | Move test y repetición | Move tests sobre video assist [S2] | No | No iniciada | Recorrer el movimiento capturando assist | — | — |
| 7.7 | Jog (teclado, gamepad) | Jogpad, gamepad [S1 p. 279, 299] | «Ir a» por eje desde la app | Parcial | Gamepad API | — | — |
| 7.8 | Ejes virtuales (cartesianos), datos 3D | Sí [S2] | No | No iniciada | Fase avanzada | — | — |
| 7.9 | Tiempo real / go-motion | Con DMC [S5] | No | Requiere hardware | Fase avanzada | — | — |
| 7.10 | Simulador de movimiento | — | Simulador con el mismo protocolo y los mismos tiempos | Probada y verificada | Simulador **separado y rotulado** | — | `tests/rig.test.js` y E2E |

## 8. Exportación

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 8.1 | MP4 H.264 | Sí (no en Linux) [S1 p. 341] | FFmpeg fuera de tiempo real (escritorio); MediaRecorder en la web | Probada y verificada | FFmpeg fuera de tiempo real (códec según licencia, ver investigación E) | FFmpeg | Pasa: número exacto de fotogramas y duración (`tests/ffmpeg.test.js`) |
| 8.2 | MOV ProRes / Animation / Photo JPEG | Sí [S1 p. 341] | MOV ProRes 422 HQ | Probada y verificada | `prores_ks`, `qtrle`, `mjpeg` | FFmpeg | Pasa (`tests/ffmpeg.test.js`) |
| 8.3 | AVI (sin compresión / MJPEG) | Sí | AVI Motion JPEG | Probada y verificada | FFmpeg | FFmpeg | Pasa (`tests/ffmpeg.test.js`) |
| 8.4 | Secuencia PNG / JPEG / TIFF | Sí, con renombrado y escala [S1 p. 344] | PNG, TIFF o JPEG a carpeta; copia de originales en orden | Probada y verificada | Exportar a carpeta, opcionalmente *conform* | FFmpeg/Sharp | Pasa (`tests/ffmpeg.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 8.5 | WAV | Exportar pista de audio [S1 p. 166] | Mezcla de las pistas que suenan, del tramo exportado (también en la web) | Probada y verificada | Mezcla a WAV | — | Pasa: duración exacta y silencio/sonido donde corresponde (E2E `tests/e2e/desktop.e2e.cjs`) |
| 8.6 | Resoluciones 720p, 1080p, 2K, 4K y personalizada | Escala [S1 p. 344] | Original, 4K, 2K, 1080p, 720p y personalizada | Implementada | Escalado + recorte o letterbox | — | — |
| 8.7 | Holds, audio sincronizado, rango y tags | Sí; step by tags (2025.09) [S3] | Holds, mezcla de audio y rango | Probada y verificada | — | — | Pasa: MP4 con los cuadros de cada hold y pista AAC (E2E `tests/e2e/desktop.e2e.cjs`) |
| 8.8 | Metadatos de postproducción | Sí [S1 p. 346] | No | No iniciada | Sidecar JSON/CSV por toma | — | — |

## 9. Interfaz

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 9.1 | Espacios de trabajo | 5 + X-Sheet [S1 p. 13] | Barra lateral de espacios (Cámara, Animar, Guías, X-Sheet, Audio, Luz, Movimiento, Proyecto) y modo Sencillo / Estudio | Implementada | ANIMATION, CAMERA, TIMELINE, X-SHEET, AUDIO, LIGHTING, MOTION CONTROL, EXPORT | — | Cada espacio conserva su distribución |
| 9.2 | Paneles acoplables y desacoplables | Paneles acoplados [S3] | Fijos | No iniciada | Sistema de *docking* propio | DOM + `BrowserWindow` | Desacoplar a una ventana en el monitor 2 y restaurar |
| 9.3 | Tema oscuro y alta legibilidad | — | Sí | Parcial | Sistema de diseño con tokens | CSS | Contraste AA |

## 10. Inteligencia artificial (opcional, siempre como sugerencia)

| # | Función | Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 10.1 | Detectar fotogramas duplicados | No documentado | Asistente de rodaje: «sin cambios respecto al anterior» | Probada y verificada | Hash perceptual | Worker | Pasa (`tests/assistant.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 10.2 | Movimiento brusco / golpe de cámara | No documentado | Asistente: desplazamiento del fondo con subpíxel; umbral ≈ 0,3 % del ancho (≈ 6 px a 1920) | Implementada | Registro de imagen (fondo estático) | OpenCV.js / WASM | Detecta 4 px a 320 de ancho (≈ 24 px a 1920) y 8 px a 640 (`tests/assistant.test.js`, E2E). **No** cumple aún «2 px» a resolución completa |
| 10.3 | Saltos de exposición | Histograma DMX (2025.05) [S3] | Asistente: cambio de luz por mediana de bloques (umbral 5 %); aviso en vivo antes de disparar | Probada y verificada | Alarma por ΔL | — | Pasa: +12 % y +15 % detectados con su signo (`tests/assistant.test.js`, E2E `tests/e2e/desktop.e2e.cjs`) |
| 10.4 | Informes de producción | — | No | No iniciada | Contadores por escena y toma, pendientes | — | — |

## 11. Funciones propias de MESORA (más allá de Dragonframe)

| # | Función | Dragonframe | MESORA hoy | Estado | Cómo se implementó | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 11.1 | Asistente de rodaje tras cada foto (cámara movida, luz, doble disparo, borde, foco) | No documentado | Avisos que nunca tocan las fotos + «Revisar toda la toma» | Probada y verificada | `js/assistant.js` | Canvas 2D | Pasa: cámara movida, luz +15 % y doble disparo detectados; las fotos no cambian (`tests/assistant.test.js`, E2E) |
| 11.2 | Vigilancia en vivo de luz y cámara antes de disparar | No documentado | Aviso en el visor si el vivo ya no coincide con el último fotograma | Implementada | `js/app.js` (liveAssistTick) | — | Sin falsos avisos con la cámara falsa de Chromium (comprobación manual registrada en el informe) |
| 11.3 | Copias de seguridad automáticas | No | Cada 10 min a otra carpeta; solo añade y actualiza | Probada y verificada | `electron/core/backup.cjs` | `fs` | Pasa: copia, no repite, nunca borra, salta exports (`tests/backup.test.js`, E2E) |
| 11.4 | Móvil como mando + API local | Keypad y mando Bluetooth de pago | Página para el móvil por QR; API HTTP con código | Probada y verificada | `electron/core/remote.cjs` | `http`, `qrcode-generator` | Pasa (`tests/remote.test.js`, E2E) |
| 11.5 | Paquete de revisión con notas por fotograma | No | Un HTML para cualquier navegador; las notas vuelven a los fotogramas | Probada y verificada | `js/review.js` | — | Pasa: ida y vuelta de notas y deshacer (E2E) |
| 11.6 | Modo aprendizaje | No | Tutorial de 7 pasos que avanza al hacer cada cosa | Probada y verificada | `js/learn.js` | — | Pasa (E2E) |
| 11.7 | Modo Sencillo / Estudio | No | Sencillo por defecto; Estudio añade X-Sheet, luz, movimiento, lip sync… | Probada y verificada | CSS + `js/app.js` | — | Pasa (E2E) |
| 11.8 | Interfaz en español e inglés | Varios idiomas | Español e inglés, cambio desde Ayuda | Probada y verificada | `js/i18n.js`, `js/i18n-en.js` | — | Pasa: interfaz en inglés y vuelta al español (E2E); revisión de todas las pestañas sin texto sin traducir |
| 11.9 | Gratis y de código abierto (GPL-3.0) | Licencia de pago | — | Implementada | `LICENSE` | — | — |

---

## Resumen numérico

Recuento automático de las filas de esta matriz (actualizado el 27-10-2026, tras las fases 1–10 y el móvil como cámara):

| Estado | Funciones |
|---|---|
| Probada y verificada | 43 |
| Implementada | 23 |
| Parcialmente implementada | 32 |
| No iniciada | 17 |
| Requiere SDK externo | 4 |
| Requiere hardware | 1 |
| **Total** | **120** |

Además, 6 filas necesitan un aparato para su prueba final («Requiere hardware»). Las 4 filas de cámaras de marca necesitan el SDK del fabricante, que el usuario debe solicitar; mientras tanto, cualquier cámara funciona con la carpeta vigilada (2.8).
