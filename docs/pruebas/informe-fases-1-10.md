# Informe de pruebas · Fases 1–10 de la auditoría

Fecha: 27-10-2026 · Rama: `claude/stoic-cannon-dkxnmg`

Este informe recoge qué se ha probado de las mejoras de la
[auditoría](../auditoria/auditoria-2026-10-26.md), cómo y con qué resultado, y qué
**no** se ha podido probar. Todo lo que aquí figura como «pasa» se ha ejecutado;
nada está estimado.

## Entornos

| Entorno | Detalle |
|---|---|
| Desarrollo | Contenedor Linux (x86_64), Node 22, Electron 45, pantalla virtual (`xvfb`), GPU por software (SwiftShader), cámara falsa de Chromium |
| Integración continua (GitHub Actions) | `ubuntu-latest`, `windows-latest` y `macos-latest`: pruebas unitarias, pruebas de píxel del visor y E2E de la app de escritorio en los tres; compilación del instalador de Windows, el `.dmg` de Mac y el APK de Android |

No se ha usado ningún aparato real: ni cámara réflex, ni luces, ni motores. Por
la norma del proyecto, nada de esto se ha movido ni disparado.

## Baterías

| Batería | Comando | Resultado |
|---|---|---|
| Unitarias | `npm test` | **73 pasan**, 0 fallan, 1 omitida (RAW reales: solo se ejecuta con muestras en `MESORA_RAW_SAMPLES`; se ejecutó a mano con RAW de Canon EOS R, Nikon Z6 y Sony A7 III en la fase 4) |
| Píxel del visor (GPU y 2D) | `npm run test:viewer` | **47 comprobaciones**, todas pasan |
| De principio a fin, app de escritorio | `npm run test:e2e` | **115 comprobaciones**, todas pasan, sin errores en la consola |
| Regresión web (navegador) | scripts de comprobación con Chromium | Captura, deshacer desde el aviso, proyectos, pistas de audio, WAV exacto y persistencia tras recargar: pasan, sin errores |

Pruebas unitarias por archivo: asistente 7, copia de seguridad 1, carpeta vigilada
y RAW 5, certificado del móvil 2, FFmpeg 4, firmware 1, color y deflicker 6,
biblioteca en disco 13, lip sync / WAV / archivos / aprendizaje 5, mando, API y
cámara del móvil 2, luces y movimiento 6, atajos 3, tiempos 4, actualizaciones 3,
X-Sheet 3, ZIP 3.

## Qué comprueba la prueba de principio a fin

Sobre la app de escritorio real, con una biblioteca y un perfil temporales:

1. Primer arranque, migración de proyectos antiguos (orden, holds, notas, audio; sin repetir).
2. Captura con la cámara falsa: originales en disco con nombres de producción.
3. Borrar, deshacer desde el aviso, papelera, historial, *conform*.
4. Exportación FFmpeg: MP4 y secuencia PNG con los cuadros exactos.
5. Carpeta vigilada: RAW + JPEG como una foto, RAW solo, copia sin mover, video assist, RAW importado; reconexión de la cámara.
6. Modo sencillo/estudio, X-Sheet (plan unido a la exposición, CSV), atajo personalizado, `Ctrl+3`, segunda pantalla.
7. Ventana de proyectos, nueva toma, eliminar proyecto a la papelera del sistema, reabrir.
8. **Asistente**: «Revisar toda la toma» encuentra la cámara movida, el cambio de luz (+15 %) y el doble disparo; no cambia ni borra fotos.
9. **Audio**: dos pistas, silencio y desplazamiento guardados; WAV de la mezcla con duración exacta y silencio donde corresponde; película con sonido AAC.
10. **Lip sync**: personaje, imagen de boca, borrador de fonemas desde la voz, boca en el visor.
11. **Móvil como mando / API**: QR, 403 sin código, página del mando, captura y navegación pedidas por la API, prohibido borrar, vista previa, apagado.
12. **Copia de seguridad**: copia completa, sin repetir, sin `exports`, desactivar no borra.
13. **Paquete de revisión**: el HTML abre con todos los fotogramas y sonido; las notas escritas en él vuelven a sus fotogramas y se pueden deshacer.
14. **Modo aprendizaje**: salta lo ya hecho, señala el botón, avanza al reproducir y al exportar, se cierra.
15. **Luz y movimiento** con simuladores: el look correcto sale por **Art-Net** antes de la foto (recibido en un socket de este mismo ordenador); «Ir a» del eje; «Moviendo…» antes de la foto; la foto se hace con el eje en la posición calculada por la curva.
16. **Inglés**: interfaz, visor y nombres de escena/toma en inglés y vuelta al español.
17. **Móvil como cámara por wifi**: otro navegador (Chromium o Chrome, con su
    cámara falsa) hace de móvil; ver la sección siguiente.

## Móvil como cámara por wifi

Montaje: la app de escritorio real y, en el mismo ordenador, un navegador que
abre la página del QR como lo haría el móvil (acepta el certificado propio igual
que el usuario al pulsar «Continuar»). La imagen va por WebRTC entre los dos
procesos. Comprobado:

- La página solo se sirve por `https` y con el código del QR (`403` sin él); al
  elegir otra cámara deja de estar disponible.
- El móvil se conecta, la app lo usa como cámara y el proyecto toma su tamaño
  (1920 × 1080, el elegido en *Resolución*).
- Las fotos llegan a la **resolución completa** del móvil aunque la imagen en
  vivo viaje más pequeña: el original en disco mide 1920 × 1080 en JPEG; en PNG
  llega **sin pérdida** y se guarda tal cual (el móvil codifica en el formato,
  calidad y volteo elegidos; no hay segunda compresión).
- Cambiar la resolución a 1280 × 720 la aplica en el móvil sin reconectar;
  el promediado de cuadros funciona.
- «Apagar la pantalla del móvil» la pone en negro.
- Si el móvil desaparece (se cierra sin despedirse), la app lo nota en unos
  segundos (latido cada segundo, corte a los 5 s sin noticias) y lo espera; el
  móvil reconecta solo.
- Con la CPU de la app frenada 6 veces (como la CI de Windows): conexión,
  foto, cambio de resolución, pérdida y reconexión del móvil y vuelta a la
  webcam, sin errores (dos ejecuciones). Esta prueba encontró y sirvió para
  corregir una carrera: elegir otra cámara mientras el móvil se conectaba podía
  dejar la app sin cámara y dar un error.

**Medidas** (contenedor Linux con GPU por software; los dos extremos en el
mismo ordenador, así que **no incluyen la wifi ni el sensor de un móvil real**):

| Medida | Resultado |
|---|---|
| Retardo de la imagen en vivo, del «móvil» a la pantalla de la app | **mediana 39–40 ms**, p95 57–63 ms, mínimo 16–18 ms (90 cuadros por ejecución, tres ejecuciones). Método: el «móvil» pinta su reloj como cuadrados blancos y negros y la app lo lee en cada cuadro que muestra |
| El mismo retardo en la CI de GitHub (máquinas virtuales sin GPU) | Linux: mediana 39 ms (p95 63); macOS: 77 ms (p95 117); Windows: 140 ms (p95 219), con la app tan cargada que la medición tardó 30 s en vez de 3 |
| Espera en el búfer de la app (jitter buffer) | 5–7 ms (32 ms en la CI de Windows) |
| Decodificación (H.264) | 3–8 ms |
| Resolución en vivo al empezar | **1920 × 1080 desde el primer medio segundo**. Sin el arranque rápido (3 Mbit/s) era 480 × 270 los primeros 3 s y 960 × 540 a los 8 s |
| Foto a resolución completa pedida al móvil (1080p, hacerla, codificarla y recibirla) | 50–110 ms tras el arranque (la primera, hasta 0,8 s) |

Del clic a ver el fotograma en el timeline pasaron 2–5 s **también con la
webcam normal** en este contenedor: guardar el original y las vistas previas
comprime varias imágenes y aquí cada compresión JPEG de 1080p tarda ~0,8 s
(GPU por software). En el camino del móvil se ahorra una de esas compresiones.
No se ha medido en un ordenador normal.

## Comprobaciones manuales registradas

- Capturas de pantalla revisadas de: panel de audio con dos pistas, página del
  mando a tamaño de móvil, paquete de revisión, tutorial, paneles de Luz y
  Movimiento, barra de transporte a 1280 px, interfaz en inglés. A raíz de ellas
  se corrigieron: el botón Capturar que quedaba fuera de la ventana, filas de luz
  y movimiento que se partían mal, un texto que desbordaba el panel, la cabecera
  del mando del móvil y un plural.
- Interfaz en inglés: se abrieron todas las pestañas y ventanas buscando texto en
  español; quedaba uno («Idioma de la interfaz»), ya traducido.
- Asistente con la cámara falsa: sin avisos falsos de luz o cámara en vivo. Un
  aviso falso de foco (la medida usaba el centro, donde está lo animado) se
  corrigió midiendo por bloques.

## Problemas encontrados por la CI y corregidos

| Problema | Causa | Arreglo |
|---|---|---|
| macOS: «WebGL2 no disponible» | SwiftShader no existe en macOS | En macOS se usa su GPU virtual |
| Windows: no llegaba a ejecutar nada | El repositorio pasó a llamarse `Stopmotion-.` y Windows quita el punto final de las carpetas | Los trabajos de Windows clonan en `C:\src` |
| Windows: 2 fotogramas en vez de 3 | La prueba pulsaba cada 600 ms y en Windows una foto tarda más (la app ignora el botón mientras hace una foto) | La prueba espera a cada foto |
| Linux: lista de proyectos antigua | La lista se refresca después de abrirse | La lista indica cuándo está al día (`aria-busy`) |

## Criterios de la auditoría

| Criterio | Resultado |
|---|---|
| Detectar un golpe de 2 px y un salto de exposición del 5 % | Salto del 5 %: sí (umbral normal 5 %). Golpe: detecta desde ≈ 0,3 % del ancho (≈ 6 px a 1920); **no** llega a 2 px a resolución completa |
| Disparar desde el móvil con < 300 ms de latencia | Funciona (E2E); **latencia no medida** con un móvil real |
| Una persona nueva anima 3 s sin ayuda en < 10 min | **No probado**: requiere una persona. Para ello existen el modo sencillo y el modo aprendizaje |
| 100 % de los textos en inglés | Sí en todas las pestañas y ventanas revisadas; textos raros de error pueden quedar en español |
| Pruebas de la matriz de equivalencia | Ver estados actualizados en la [matriz](../investigacion/03-matriz-equivalencia.md): 43 funciones probadas y verificadas (antes 8) |

## Lo que no se ha probado

- **Cámaras réflex o sin espejo reales** con su programa de tethering (se probó con archivos que imitan su escritura por partes y con RAW reales importados).
- **Luces DMX y nodos Art-Net reales, ENTTEC DMX USB Pro**: solo formato de paquetes y envío a este mismo ordenador.
- **Firmware MESORA-Moco en una placa**: compilado con el compilador del sistema y ejecutado con un Arduino simulado; no con el compilador de Arduino ni con motores.
- **Móvil real** como mando (sí la página a tamaño de móvil en un navegador).
- **Móvil real como cámara por wifi**: ni Android ni iPhone; ni el aviso del
  certificado en sus navegadores, ni los controles de cámara que expongan, ni el
  retardo añadido por la wifi y por su cámara. La conexión WebRTC, las fotos y el
  retardo de la cadena se midieron con otro navegador en el mismo ordenador.
- Rendimiento con tomas muy largas (más de 5.000 fotogramas) y con GPU real.
