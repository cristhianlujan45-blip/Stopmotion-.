# MESORA Studio

Un estudio de animación **stop motion** que funciona en el navegador. Es gratuito, no se instala, funciona sin conexión y no tiene dependencias.
Captura con tu webcam o una cámara USB/HDMI (con capturadora), anima con papel cebolla y exporta a MP4/WebM o a secuencia de imágenes.

## Cómo usarlo

```bash
npm start          # abre http://localhost:5173
```

También se puede publicar tal cual en cualquier hosting estático con HTTPS (GitHub Pages, Netlify…).
La cámara solo está disponible en `https://` o `localhost`. Abrir `index.html` directamente desde el disco no funciona.

Requisitos: Chrome/Edge 100+ (recomendado), Firefox o Safari recientes. Node 18+ solo hace falta para el servidor local y los tests.

## Primeros pasos

La primera vez que abres MESORA aparece una **guía de inicio** en cuatro pasos. Puedes volver a abrirla desde el botón **?**.
Cada panel explica para qué sirve y las opciones avanzadas están plegadas para no abrumar.

## Funciones

**Captura**
- Vista en vivo de cualquier cámara del sistema, a resoluciones de hasta 4K.
- **Promediado de ruido**: combina 2–16 cuadros por captura para obtener imágenes limpias con poca luz.
- Controles de hardware cuando la cámara los expone: exposición, ISO, foco, balance de blancos, zoom, etc.
- **Bloquear automáticos** para evitar el parpadeo de exposición entre fotogramas. Los ajustes se recuerdan por cámara.
- Espejo y volteo, JPEG o PNG sin pérdida, retardo de disparo de 2, 5 o 10 s y sonido de obturador.
- Captura en cola: puedes disparar rápido sin perder fotogramas.
- Reemplazar el fotograma actual (`Shift+Enter`) o insertar después de él (`Alt+Enter`).
- **Intervalómetro** para time-lapse.

**Visualización**
- Papel cebolla de 1 a 6 fotogramas con opacidad ajustable.
- Alternar entre vivo y último fotograma (`2`), **parpadeo automático** (`B`) y **modo diferencia** (`D`) para ver con precisión qué se movió.
- **Croma (pantalla verde) en tiempo real** con supresión de derrame y una imagen de fondo.
- **Focus peaking**, **lupa 1:1** a resolución nativa e **histograma** RGB con aviso de recorte.
- Cuadrículas (tercios, cuartos, fina, cruz), máscaras de encuadre (2.39, 1.85, 16:9, 4:3, 1:1, 4:5, 9:16) y zonas seguras.
- **Capa de guías** dibujada a mano para trayectorias y arcos. Las guías no salen en la captura.

**Color y luz**
- **Estabilización de luz automática (deflicker)**: corrige los cambios de brillo entre fotos causados por luz natural o por la cámara. Respeta los fundidos intencionados. En una prueba con fotos que saltaban un 25 % de brillo, quedaron dentro del 3 %.
- Brillo, contraste y saturación. Se aplican al revisar, reproducir y exportar sin tocar las fotos originales.

**Referencia (rotoscopia)**
- Carga un video de actuación, una animática o una imagen de storyboard. Se superpone sincronizada con la línea de tiempo, con opacidad y desfase ajustables, y nunca sale en el resultado.

**Línea de tiempo (X-sheet)**
- **Regla de tiempo**: arrástrala para recorrer la animación (con sonido). La rueda del ratón desplaza la línea y `Ctrl` + rueda hace zoom.
- **Notas por fotograma** (diálogo, fonemas A/E/O/M, indicaciones), visibles en la celda y sobre la imagen. Atajo `N`.
- Duración de cada fotograma (en unos, en doses…). El ancho de cada celda es proporcional a su duración.
- Selección múltiple, reordenar arrastrando, duplicar, eliminar y deshacer/rehacer ilimitado.
- Reproducción completa, por rango seleccionado, en bucle, ping-pong y **reproducción corta** (últimos N fotogramas y de vuelta a vivo).
- **Audio para lip-sync**: forma de onda alineada con los fotogramas, desfase configurable y *scrub*, que reproduce el sonido de cada fotograma al recorrerlo.

**Herramientas**
- **Calculadora de espaciado**: cuántos milímetros mover el objeto en cada fotograma con curvas lineales, ease-in, ease-out y ease-in-out.

**Proyectos y exportación**
- Varios proyectos guardados automáticamente en el navegador (IndexedDB). Un indicador muestra «Guardado» en todo momento.
- Exportar **video MP4 (H.264) o WebM** con audio a la resolución original, 4K, 1080p, 720p o 480p.
- Exportar una **secuencia de imágenes en ZIP** con las capturas originales, opcionalmente repitiendo cada fotograma según sus exposiciones.
- Exportar e importar el proyecto completo como `.mesora` (copia de seguridad o traspaso a otro equipo).
- Importar imágenes y audio arrastrándolos a la ventana.
- Aplicación instalable (PWA) que funciona sin conexión.

## Atajos principales

| Tecla | Acción |
| --- | --- |
| `Enter` | Capturar |
| `0` / `Espacio` | Reproducir / detener |
| `1` / `←`, `3` / `→` | Fotograma anterior / siguiente |
| `2` / `Tab` | Alternar vivo ↔ último |
| `5` / `Fin` | Ir a vista en vivo |
| `6` | Reproducción corta |
| `8` / `L`, `P` | Bucle, ping-pong |
| `O`, `D`, `B` | Papel cebolla, diferencia, parpadeo |
| `G`, `F`, `Z` | Cuadrícula, focus peaking, lupa |
| `+` / `−` | Duración del fotograma |
| `N` | Nota del fotograma |
| `Shift+F` | Pantalla completa |
| `Supr`, `Ctrl+D` | Eliminar, duplicar |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Deshacer, rehacer |
| `?` | Todos los atajos |

Las teclas numéricas siguen la disposición del teclado numérico que usan los animadores profesionales.

## MESORA frente a Dragonframe

| | MESORA Studio | Dragonframe |
| --- | --- | --- |
| Precio | Gratis | Licencia de pago |
| Instalación | Ninguna, abre en el navegador (Windows, Mac, Linux, Chromebook, tableta) | Programa de escritorio |
| Deflicker automático | Integrado | Se suele hacer después con herramientas externas |
| Papel cebolla, diferencia, parpadeo | Sí | Sí |
| X-sheet con duración y notas | Sí | Sí |
| Audio y lip-sync | Forma de onda, scrub y notas de fonemas | Más completo (pistas de diálogo, tablas de fonemas) |
| Referencia/rotoscopia | Sí | Sí |
| Control de réflex/sin espejo por USB | No (sí como webcam) | Sí |
| Control de movimiento e iluminación DMX | No | Sí |

## Limitaciones honestas

Frente a Dragonframe, MESORA no hace dos cosas, porque el navegador no tiene acceso a ellas:
- **Control de cámaras réflex o sin espejo por USB** (disparo y ajustes de Canon, Nikon o Sony). Sí puedes usarlas como cámara web, mediante la función "webcam" del fabricante o una capturadora HDMI.
- **Control de movimiento** (motores DMX/Arduino) e iluminación DMX.

Los datos se guardan en el almacenamiento del navegador. Exporta tu proyecto en `.mesora` de vez en cuando como copia de seguridad.

## Estructura

```
index.html            interfaz
css/styles.css        estilos
js/app.js             orquestación, estado y atajos
js/camera.js          cámara, controles y captura con promediado
js/viewer.js          composición: cebolla, diferencia, croma, peaking, lupa, guías
js/timeline.js        línea de tiempo / X-sheet
js/framestore.js      almacenamiento de fotogramas y caché de imágenes
js/audio.js           audio, forma de onda y scrub
js/exporter.js        exportación de video y secuencias
js/projectio.js       archivos .mesora
js/zip.js             lector/escritor ZIP sin dependencias
js/timing.js          exposiciones, timecode y espaciado (funciones puras)
js/grading.js         deflicker y corrección de color (funciones puras)
sw.js                 modo sin conexión
```

## Tests

```bash
npm test
```
