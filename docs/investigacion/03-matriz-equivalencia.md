# Etapa 3 · Matriz de equivalencia Dragonframe ↔ MESORA

Fecha: 26-10-2026 · Versión de MESORA evaluada: 1.0.0 (commit `469082b`).

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

> Hasta la inspección directa, ninguna fila de Dragonframe es **[OBS]**. Ninguna función de MESORA figura como «Probada y verificada» porque aún no existe el registro de pruebas de aceptación. Las 13 pruebas unitarias actuales cubren cálculos auxiliares, no funciones completas.

---

## 1. Núcleo, proyecto y archivos

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 1.1 | Producción › escena › toma | Escena = carpeta + `.dgn`; tomas dentro [S1 p. 9, 149] | Proyectos planos, sin escenas ni tomas | No iniciada | Modelo propio: Producción › Escena › Toma › Exposición | Proceso principal de Electron, `fs` | Crear producción con 2 escenas × 2 tomas; reabrir; estructura idéntica en disco |
| 1.2 | Originales como archivos accesibles | Carpetas de exposición `X1…Xn` con nombres legibles [S1 p. 335] | Blobs en IndexedDB | No iniciada | Archivos inmutables en la carpeta del proyecto | `fs`, escritura atómica | Los archivos se abren en un visor externo; sus hashes coinciden con lo que entregó la cámara |
| 1.3 | Edición virtual + conform | Las ediciones no tocan los archivos; *conform* renumera [S1 p. 335] | Orden de fotogramas en un objeto JSON (en IndexedDB) | Parcial | Lista de edición (EDL) versionada; conform = copia renumerada | JSON con journal | Editar 100 operaciones: 0 archivos originales modificados (hash) |
| 1.4 | Papelera de fotogramas | Carpeta `_backup` con lo borrado; restaurar [S1 p. 133, 335] | Deshacer en memoria | Parcial | Borrar = mover a `trash/` + entrada en EDL; restaurar | `fs.rename` | Borrar, cerrar la app, reabrir y restaurar: fotograma idéntico |
| 1.5 | Guardado automático | Continuo [DED] | Sí (IndexedDB, indicador «Guardado») | Parcial | Journal de operaciones + snapshot periódico en disco | `fs` + fsync | Matar el proceso tras cada tipo de operación: al reabrir no se pierde nada confirmado |
| 1.6 | Recuperación ante fallos | [DESC] | No | No iniciada | Repetir el journal al arrancar; detectar capturas huérfanas | — | Corte durante la descarga de un RAW: el archivo parcial se detecta y no corrompe la toma |
| 1.7 | Duplicar escena | Sí [S1 p. 152] | Duplicar proyecto: no | No iniciada | Copia de ajustes y EDL; los originales por *hardlink* o copia | `fs.link`/`copyFile` | Duplicar: los cambios en la copia no afectan al original |
| 1.8 | Plantillas e importar ajustes de escena | Sí [S1 p. 156–157] | No | No iniciada | Plantilla = JSON de ajustes | — | Nueva escena desde plantilla con cámara, fps y guías iguales |
| 1.9 | Importar imágenes | Importar secuencia (DF3.6) [S1 p. 154] | Sí (arrastrar) | Parcial | Copia a la toma, conservando los bytes originales | — | Importar 500 JPEG/PNG/TIFF: orden y bytes correctos |
| 1.10 | Exportar/importar proyecto completo | Carpetas directas | `.mesora` (zip) | Parcial | El proyecto *es* una carpeta; exportación empaquetada opcional | — | Ida y vuelta entre dos equipos sin pérdida |
| 1.11 | Notas de escena (Notepad) | Notepad y notas por fotograma (DF4.1) [S1 p. 209] | Notas por fotograma | Parcial | Notas de escena y por fotograma en el modelo | — | Las notas aparecen en el X-Sheet y en la exportación CSV |
| 1.12 | Frame Tags | Etiquetas de fotograma (DF5.2); reproducir y exportar por tags (2025.09/2026.01) [S3] | No | No iniciada | Etiquetas en la EDL | — | Reproducir y exportar solo los fotogramas etiquetados |

## 2. Cámara y captura

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 2.1 | Capa de adaptadores de cámara | Múltiples fuentes de captura [S1 p. 39–50] | Una única clase `Camera` (getUserMedia) | No iniciada | Interfaz `CameraAdapter` + registro de adaptadores (ver arquitectura) | — | Las pruebas del contrato pasan para cada adaptador |
| 2.2 | Webcam / UVC / capturadora HDMI | Soportado | Sí, hasta 4K | Parcial | Adaptador `uvc` (código actual migrado) | Chromium `getUserMedia` | Live view ≥ 25 fps a 1080p; captura PNG sin pérdida |
| 2.3 | Canon EOS (réflex y sin espejo) | Recomendado; live view y captura [S8] | No | Requiere SDK | Adaptador `canon-edsdk` en un proceso nativo separado | EDSDK (registro en Canon), C++ | Live view, captura RAW+JPEG a disco, cambio de ISO/apertura/obturación, desconexión y reconexión |
| 2.4 | Sony α | Soportado (modelos limitados) [S8] | No | Requiere SDK | Adaptador `sony-crsdk` | Camera Remote SDK | Igual que 2.3 |
| 2.5 | Nikon | Soportado [S8] | No | Requiere SDK | Adaptador `nikon-maid` | Nikon SDK por modelo | Igual que 2.3 |
| 2.6 | Fujifilm, OM System | Soportado [S8] | No | Requiere SDK | Adaptadores posteriores | SDK [DESC] | Igual que 2.3 |
| 2.7 | Linux/macOS: libgphoto2 | — | No | No iniciada | Adaptador `gphoto2` (no aplica a Windows) | libgphoto2 (LGPL) | Igual que 2.3 en Linux |
| 2.8 | Carpeta vigilada | *Folder watching* [S2] | No | No iniciada | Vigilar la carpeta del tethering del fabricante y asignar cada archivo al fotograma pendiente | `fs.watch` + escritura estable | 50 capturas con EOS Utility: 50 fotogramas en orden, RAW intacto |
| 2.9 | Video assist + alta calidad en paralelo | Dos secuencias sincronizadas [S1 p. 1–2] | Una sola fuente | No iniciada | Fuente de vista ≠ fuente de captura, emparejadas por fotograma | — | Disparar 20 veces: 20 assist + 20 HQ emparejados |
| 2.10 | ISO, apertura, obturación, balance de blancos | Controles gráficos [S2] | Controles de pista cuando la webcam los expone | Parcial | Propiedades genéricas tipadas por adaptador | SDK | El valor leído después de escribir coincide con el de la cámara |
| 2.11 | Enfoque y comprobación de foco | Focus check, punch-in, peaking [S2; S3] | Peaking y lupa 1:1 | Parcial | Enfoque por SDK cuando exista; peaking en GPU | WebGL2 | Mover el foco por pasos desde la app (si el SDK lo permite) |
| 2.12 | Histograma, recortes y densitómetro | Sí [S2] | Histograma RGB con aviso de recorte | Parcial | + densitómetro en un punto y vista de recortes | WebGL2/Worker | Comparar con una imagen sintética de valores conocidos |
| 2.13 | Tomas de prueba y comparación A/B | Sistema de test shots [S2] | No | No iniciada | Tomas de prueba fuera de la secuencia + comparador A/B | — | Las tomas de prueba no aparecen en el timeline ni en la exportación |
| 2.14 | Exposiciones múltiples (X1…X12) | Hasta 12 por toma, cada una con sus ajustes [S1 p. 9, 94] | Promediado de ruido (otra función) | No iniciada | Exposiciones con perfil de cámara y DMX propios | — | 3 exposiciones por fotograma en el orden correcto |
| 2.15 | Promediado de vídeo | *Video frame averaging* [S2] | Sí (2–16 cuadros) | Parcial | Se conserva | — | Reducción del ruido medida en un patrón |
| 2.16 | Disparo por teclado, botón y mando | Keypad, Bluetooth, Simple Interface [S2; S4] | Teclado y botón | Parcial | + mando por serie/TCP y gamepad | Web Serial / `net` | Comando `S 1` por serie: captura completa |
| 2.17 | Captura en cola y bloqueo | Captura a disco inmediata [S1 p. 3] | Cola de capturas | Parcial | Cola por adaptador con confirmación del archivo escrito | — | 10 disparos rápidos: 10 archivos, ninguno perdido |
| 2.18 | Detección de desconexión y reconexión | [DESC] | `onEnded` de la pista | Parcial | Monitor de estado + reconexión automática sin perder el fotograma pendiente | — | Desenchufar USB a mitad: aviso, reconectar, seguir |
| 2.19 | Ajustes por escena y bloqueo de exposición | Sí [S2] | Bloquear automáticos, recordar por cámara | Parcial | Perfil de cámara por escena y exposición | — | Reabrir la escena reaplica los ajustes |
| 2.20 | Intervalómetro / time-lapse | Sí [S1 p. 145] | Sí | Parcial | Se conserva, integrado con la cola | — | 100 disparos a 2 s con desviación < 50 ms |
| 2.21 | Multicámara | Hasta 8 (DF5.2) [S3] | No | No iniciada | Varias instancias de adaptador | — | 2 webcams capturando a la vez en exposiciones distintas |
| 2.22 | Captura *making-of* | DF5.0 [S3] | No | No iniciada | Segunda fuente grabando en segundo plano | — | — |

## 3. Herramientas de animación y visor

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 3.1 | Onion skin (opacidad, último sobre vivo) | Deslizador bidireccional [S1 p. 121] | 1–6 fotogramas, opacidad | Parcial | Deslizador bidireccional (vivo↔fotograma) | WebGL2 | Mezcla exacta en píxel comprobada con imágenes de prueba |
| 3.2 | Varios fotogramas, colores diferenciados | Hasta 5 fotogramas [S1 p. 123] | Varios, sin tinte por dirección | Parcial | Tinte anterior/siguiente y caída de opacidad | WebGL2 | — |
| 3.3 | Modo diferencia | Sí [S1 p. 122] | Sí (`D`) | Parcial | Se conserva, en GPU | WebGL2 | Imágenes idénticas → negro absoluto |
| 3.4 | Claros y oscuros prominentes (Frame Echo) | Sí [S1 p. 122] | No | No iniciada | Mezcla *lighten* y *darken* en shader | WebGL2 | Mezcla correcta sobre una imagen de prueba |
| 3.5 | Alternar vivo / último y auto toggle | Sí [S2] | `2` y `B` (parpadeo) | Parcial | Se conserva | — | — |
| 3.6 | Capturar, duplicar, eliminar, insertar, reemplazar | Sí [S1 cap. 8] | Sí | Parcial | Operaciones sobre la EDL (ver 1.3) | — | Batería de operaciones con el resultado esperado de la EDL |
| 3.7 | Hold / exposición múltiple de un cuadro | Hold, *virtual holds* [S1 p. 117, 134] | Duración por fotograma | Parcial | Hold en la EDL; «Shoot Multiple» | — | `Ctrl+3` → 3 cuadros |
| 3.8 | Deshacer / rehacer | Sí | Ilimitado en memoria | Parcial | Deshacer persistente vía journal | — | Deshacer después de reiniciar |
| 3.9 | Guías de composición, rejillas y máscaras | Aspect mask, TV-safe, push-in mask, rejillas [S2] | Rejillas, máscaras de aspecto, zonas seguras | Parcial | + máscara de *push-in*; guías alternativas | Canvas/WebGL | — |
| 3.10 | Capas de dibujo y guías vectoriales | Drawing layers, Guide layers, editor de incrementos [S1 p. 59; S2] | Capa de guías a mano | Parcial | Capas vectoriales múltiples + editor de incrementos (espaciado) | SVG/Canvas | Las guías nunca aparecen en la captura ni en la exportación |
| 3.11 | Líneas de movimiento / trayectorias | Increment editor, marcadores de trayectoria [S2] | Calculadora de espaciado | Parcial | Trayectoria con marcas de espaciado dibujadas en la vista | — | — |
| 3.12 | Rotoscopia y referencias superpuestas | Roto layers, media layers, varias referencias [S1 p. 63, 124] | Una referencia (vídeo o imagen) | Parcial | Varias capas de medio con transformación y opacidad | — | Referencia sincronizada al fotograma ±0 |
| 3.13 | Croma / pantalla verde | Chromakey y garbage matte [S2] | Croma en tiempo real + fondo | Parcial | + garbage matte | WebGL2 | — |
| 3.14 | Punch-in (lupa del live view) | Live View Mag [S2] | Lupa 1:1 | Parcial | Zoom del sensor por SDK si existe | SDK | — |
| 3.15 | Monitor auxiliar / segundo monitor | Sí [S2] | No | No iniciada | Ventana secundaria de Electron con la vista | `BrowserWindow` | La vista en el monitor 2 sigue al principal en < 1 fotograma |
| 3.16 | Atajos configurables | Sí [S2] | Atajos fijos | Parcial | Mapa de atajos editable y exportable | — | Reasignar una tecla persiste tras reiniciar |
| 3.17 | Calculadora de espaciado | (Increment editor) | Sí (lineal/ease) | Parcial | Se conserva | — | Pruebas unitarias existentes |
| 3.18 | Deflicker / estabilizar luz | No es una función destacada de DF [DED] | Sí | Parcial | Se conserva (función diferencial de MESORA) | — | Pruebas unitarias existentes |

## 4. Timeline y X-Sheet

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 4.1 | Miniaturas y navegación | Sí [S1 p. 131] | Sí | Parcial | Virtualizado para más de 10.000 fotogramas | — | Desplazamiento fluido con 10.000 fotogramas |
| 4.2 | Arrastrar: insertar o sobrescribir | Marcadores amarillo/rojo, arrastre lateral [S1 p. 133–134] | Reordenar arrastrando | Parcial | Las dos semánticas documentadas | — | Casos de la EDL |
| 4.3 | Cortar, copiar, pegar (también inverso) | Sí [S1 p. 135] | Duplicar y eliminar | Parcial | Portapapeles de fotogramas | — | — |
| 4.4 | Marcadores, entrada/salida, Nav-Line | `I`/`O`, más allá de lo rodado [S1 p. 116] | Rango seleccionado | Parcial | Puntos de entrada y salida + marcadores con nombre | — | — |
| 4.5 | FPS 8, 10, 12, 15, 18, 24, 25, 30 y personalizado | FPS del proyecto + velocidad de reproducción temporal [S1 p. 116] | 6–30, **sin 18 ni personalizado** | Parcial | Añadir 18 y personalizado; separar FPS del proyecto y de reproducción | — | Reproducción a 24 fps: deriva < 1 fotograma en 10 min |
| 4.6 | Reproducción fluida en alta resolución | Proxies `hq` en RAM [S1 p. 335] | Caché LRU de vistas previas | Parcial | Proxies en disco + caché + decodificación en Worker | `createImageBitmap`, Workers | 24 fps sin saltos con 2.000 fotogramas a 1080p |
| 4.7 | Bucle, ping-pong, short play | Sí [S2] | Sí | Parcial | Se conserva | — | — |
| 4.8 | X-Sheet sincronizado | Columnas y marcas X/C, edición desde la hoja [S1 cap. 11] | Notas en las celdas del timeline | Parcial | Vista X-Sheet independiente sobre el **mismo** modelo que el timeline | — | Editar en uno se ve en el otro en el mismo ciclo de render |
| 4.9 | Columnas: diálogo, fonemas, cámara, luz, notas, acción | Sí [S1 cap. 11] | Nota libre | No iniciada | Columnas tipadas + columnas personalizadas | — | — |
| 4.10 | Longitud de escena y fotograma inicial | 48 por defecto, crece [S1 p. 190] | No | No iniciada | En los ajustes de escena | — | — |
| 4.11 | Imprimir y exportar CSV | Sí [S1 p. 201–203] | No | No iniciada | Exportar CSV + impresión/PDF | `webContents.printToPDF` | CSV reimportable sin pérdida |

## 5. Audio y Lip sync

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 5.1 | Importar WAV y MP3 | Sí [S1 p. 162] | Un archivo de audio | Parcial | Se conservan los archivos originales | Web Audio | — |
| 5.2 | Varias pistas | Multi-track [S2] | Una pista | No iniciada | Pistas con desfase, recorte y mute | Web Audio | 3 pistas mezcladas y sincronizadas |
| 5.3 | Forma de onda, scrub | Sí [S1 p. 162] | Sí | Parcial | Picos precalculados (multirresolución) | Worker | — |
| 5.4 | Recortar, mover, exportar pista editada | Sí [S1 p. 163–166] | Desfase | Parcial | Edición no destructiva | — | — |
| 5.5 | Time-Warp (audio sincronizado a otra velocidad) | Sí [S2] | No | No iniciada | Reproducción del audio acompasada a la velocidad | Web Audio `playbackRate` | — |
| 5.6 | Personajes y face sets | Face sets en PSD multicapa, personajes [S1 p. 171–175] | No | No iniciada | Biblioteca propia: carpeta de imágenes o PSD (lectura de capas) | Lector PSD (p. ej. `ag-psd`) | Cargar un PSD de 10 bocas → 10 formas |
| 5.7 | Track reading (fonemas por fotograma) | Fila por personaje con cues [S1 p. 175–182] | Notas con fonemas | Parcial | Pista de fonemas por personaje y fotograma | — | — |
| 5.8 | Marcadores de audio | Sí, `Ctrl+flechas` [S1 p. 182] | No | No iniciada | — | — | — |
| 5.9 | HUD de boca en Animation | Sí [S1 p. 182] | Nota sobre la imagen | Parcial | HUD con la forma de boca | — | — |
| 5.10 | Exportar/importar lectura; time remap para After Effects | Sí [S1 p. 183–185] | No | No iniciada | Formatos de texto abiertos (p. ej. Papagayo MOHO `.dat`) [DED] | — | — |
| 5.11 | Lectura automática de fonemas | No documentada en DF [DED] | No | No iniciada | Opcional (etapa IA): sugerencia de fonemas desde el audio | Modelo local [DESC] | Siempre como sugerencia editable |

## 6. Iluminación (DMX)

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 6.1 | Salida ENTTEC DMX USB Pro | Soportado [S7] | No | Requiere hardware | Driver de serie, etiqueta 6 | `serialport` (nativo) o Web Serial | Prueba de bytes contra la especificación + prueba con el aparato |
| 6.2 | Salida Art-Net | Soportado [S7] | No | No iniciada | Emisor ArtDmx por UDP | `dgram` | Captura de paquetes validada contra la especificación (sin hardware) |
| 6.3 | Canales, intensidad, RGB, temperatura de color | Perfiles de luz [S1 p. 225] | No | No iniciada | Perfiles de aparato (canales → atributos) | — | — |
| 6.4 | Keyframes por fotograma + curvas | Keyframes con Bézier, tabla [S1 p. 216–221; S2] | No | No iniciada | Pista de automatización por canal o grupo | — | Valores interpolados exactos por fotograma |
| 6.5 | Grupos, filtros, guardar y cargar canal | Sí [S1 p. 222–225] | No | No iniciada | — | — | — |
| 6.6 | Programas por exposición | Sí [S1 p. 231] | No | No iniciada | Requiere 2.14 | — | — |
| 6.7 | Bash light (luz de trabajo) | Sí [S1 p. 229] | No | No iniciada | Escena de luz «trabajo» automática entre disparos | — | — |
| 6.8 | Perfiles por escena y repetir | Sí | No | No iniciada | En los ajustes de escena | — | — |
| 6.9 | Simulador DMX | — | No | No iniciada | Visualizador de universo, **marcado como simulador** | — | — |

## 7. Motion control

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 7.1 | Arduino + paso a paso (shoot-move-shoot) | DFMoco 4–8 ejes [S6] | No | Requiere hardware | Firmware propio **MESORA-Moco** + host | Arduino, `serialport` | Simulador + banco con Arduino: posición exacta en 100 ciclos |
| 7.2 | Compatibilidad DFMoco | Protocolo en `.rtf` [S6] | No | No iniciada | Driver de host según la especificación oficial (pendiente) | — | Contra un rig DFMoco real del usuario |
| 7.3 | Ejes: pan, tilt, dolly, slider, foco o zoom | Arc [S1 cap. 14] | No | No iniciada | Ejes configurables (unidades, pasos/unidad, límites) | — | — |
| 7.4 | Keyframes y curvas por eje | Sí [S1 p. 249] | No | No iniciada | Pista de automatización (compartida con DMX) | — | Posición por fotograma = curva evaluada |
| 7.5 | Velocidad, aceleración, límites | Sí [S2] | No | No iniciada | Rampas trapezoidales en el firmware | — | — |
| 7.6 | Move test y repetición | Move tests sobre video assist [S2] | No | No iniciada | Recorrer el movimiento capturando assist | — | — |
| 7.7 | Jog (teclado, gamepad) | Jogpad, gamepad [S1 p. 279, 299] | No | No iniciada | Gamepad API | — | — |
| 7.8 | Ejes virtuales (cartesianos), datos 3D | Sí [S2] | No | No iniciada | Fase avanzada | — | — |
| 7.9 | Tiempo real / go-motion | Con DMC [S5] | No | Requiere hardware | Fase avanzada | — | — |
| 7.10 | Simulador de movimiento | — | No | No iniciada | Simulador **separado y rotulado** | — | Base de todas las pruebas automáticas de 7.x |

## 8. Exportación

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 8.1 | MP4 H.264 | Sí (no en Linux) [S1 p. 341] | MediaRecorder en tiempo real | Parcial | FFmpeg fuera de tiempo real (códec según licencia, ver investigación E) | FFmpeg | 1 fotograma de vídeo = 1 fotograma de animación (sin duplicados ni saltos) |
| 8.2 | MOV ProRes / Animation / Photo JPEG | Sí [S1 p. 341] | No | No iniciada | `prores_ks`, `qtrle`, `mjpeg` | FFmpeg | `ffprobe` confirma el códec y el número de fotogramas |
| 8.3 | AVI (sin compresión / MJPEG) | Sí | No | No iniciada | FFmpeg | FFmpeg | Igual |
| 8.4 | Secuencia PNG / JPEG / TIFF | Sí, con renombrado y escala [S1 p. 344] | ZIP de originales | Parcial | Exportar a carpeta, opcionalmente *conform* | FFmpeg/Sharp | Bytes idénticos cuando no hay conversión |
| 8.5 | WAV | Exportar pista de audio [S1 p. 166] | No | No iniciada | Mezcla a WAV | — | — |
| 8.6 | Resoluciones 720p, 1080p, 2K, 4K y personalizada | Escala [S1 p. 344] | Hasta 4K | Parcial | Escalado + recorte o letterbox | — | — |
| 8.7 | Holds, audio sincronizado, rango y tags | Sí; step by tags (2025.09) [S3] | Holds y audio | Parcial | — | — | Duración del audio = duración del vídeo ± 1 fotograma |
| 8.8 | Metadatos de postproducción | Sí [S1 p. 346] | No | No iniciada | Sidecar JSON/CSV por toma | — | — |

## 9. Interfaz

| # | Función | Cómo funciona en Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 9.1 | Espacios de trabajo | 5 + X-Sheet [S1 p. 13] | Pestañas laterales | Parcial | ANIMATION, CAMERA, TIMELINE, X-SHEET, AUDIO, LIGHTING, MOTION CONTROL, EXPORT | — | Cada espacio conserva su distribución |
| 9.2 | Paneles acoplables y desacoplables | Paneles acoplados [S3] | Fijos | No iniciada | Sistema de *docking* propio | DOM + `BrowserWindow` | Desacoplar a una ventana en el monitor 2 y restaurar |
| 9.3 | Tema oscuro y alta legibilidad | — | Sí | Parcial | Sistema de diseño con tokens | CSS | Contraste AA |

## 10. Inteligencia artificial (opcional, siempre como sugerencia)

| # | Función | Dragonframe | MESORA hoy | Estado | Cómo se implementará | Tecnología / dependencias | Prueba de aceptación |
|---|---|---|---|---|---|---|---|
| 10.1 | Detectar fotogramas duplicados | No documentado | No | No iniciada | Hash perceptual | Worker | Precisión sobre un conjunto etiquetado |
| 10.2 | Movimiento brusco / golpe de cámara | No documentado | No | No iniciada | Registro de imagen (fondo estático) | OpenCV.js / WASM | Detectar un desplazamiento de 2 px |
| 10.3 | Saltos de exposición | Histograma DMX (2025.05) [S3] | Deflicker mide la luma | Parcial | Alarma por ΔL | — | — |
| 10.4 | Informes de producción | — | No | No iniciada | Contadores por escena y toma, pendientes | — | — |

---

## Resumen numérico

Recuento automático de las filas de esta matriz:

| Estado | Funciones |
|---|---|
| Probada y verificada | 0 |
| Implementada | 0 |
| Parcialmente implementada | 52 |
| No iniciada | 49 |
| Requiere SDK externo (cámaras de marca, filas 2.3–2.6) | 4 |
| Requiere hardware (filas 6.1, 7.1, 7.9) | 3 |
| **Total** | **108** |

Las 7 filas que requieren SDK o hardware tampoco están iniciadas.
