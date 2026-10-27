# Manual de MESORA Studio

Este manual sigue el orden de trabajo de un rodaje: preparar, capturar, animar,
revisar y entregar. Lo marcado con **(Estudio)** solo aparece en el modo Estudio
(botón arriba a la derecha); lo marcado con **(escritorio)** solo existe en la app
de Windows, Mac o Linux.

## 1. Empezar

1. Abre MESORA. La primera vez verás la **guía de inicio**. Si es tu primera
   animación, pulsa **Aprender paso a paso**: un recuadro abajo a la izquierda te
   dice qué hacer, señala el botón y avanza solo cuando lo haces.
2. Elige el idioma en la misma ventana (o después en *Ayuda › Idioma*).
3. El modo **Sencillo** muestra lo esencial. Cambia a **Estudio** cuando necesites
   X-Sheet, lip sync, luces, motion control o los atajos de captura múltiple.

La pantalla tiene cuatro zonas: el **visor** (centro), la **barra lateral de
espacios de trabajo** (derecha: Cámara, Animar, Guías, X-Sheet, Audio, Luz,
Movimiento, Proyecto), la **barra de transporte** (reproducir, fps, duración,
deshacer y el botón rojo **Capturar**, siempre visible) y el **timeline** (abajo).

## 2. Proyectos, escenas y tomas

- **(escritorio)** Cada proyecto es una carpeta en `Documentos/MESORA`, con
  escenas (`sc010`, `sc020`…) y tomas (`tk01`, `tk02`…). Las fotos originales se
  guardan como archivos normales y MESORA nunca las sobrescribe ni las borra.
- **Proyectos** (arriba) muestra cada proyecto con sus escenas y tomas. El menú
  **⋯** crea una toma nueva, duplica la escena, exporta una copia `.mesora` o
  elimina (va a la papelera del sistema). Pulsar «Escena · Toma» arriba lleva a
  la misma lista.
- Todo se guarda solo; el indicador «Guardado» lo confirma.
- **Proyecto › Papelera**: fotogramas borrados de la toma (sus originales siguen
  en el disco). **Historial**: versiones anteriores del timeline.
- Si el ordenador se apaga de golpe, al volver a abrir la toma las fotos que no
  llegaron al timeline aparecen al final con una nota.

## 3. Cámara

### Webcam, cámara USB o capturadora HDMI

*Cámara › Fuente*: elige el dispositivo y la resolución y pulsa **Conectar**.
En *Controles de cámara*, **Bloquear automáticos** fija exposición, foco y balance
para evitar parpadeos (si la cámara lo permite desde el navegador).

### Réflex o sin espejo **(escritorio)**

1. Conecta la cámara por USB y abre su programa oficial de disparo remoto
   (EOS Utility, NX Tether, Imaging Edge, X Acquire…). Configúralo para guardar
   las fotos en una carpeta del ordenador.
2. En MESORA, *Cámara › Cámara de fotos* › **Elegir carpeta…** y elige esa carpeta.
3. Dispara desde la cámara o desde su programa: cada foto entra sola como
   fotograma en cuanto termina de escribirse. Las fotos se **copian**, nunca se
   mueven. RAW + JPEG de la misma foto cuentan como una.
4. **Video assist**: si además conectas una webcam o la salida HDMI de la cámara
   (capturadora), activa *Guardar también la imagen en vivo*: se guarda lo que se
   veía al llegar cada foto. En *En el visor mostrar* eliges ver las fotos de la
   cámara o el video assist.

### Ajustes de captura

Promediado de ruido (combina varios cuadros con poca luz), formato JPEG o PNG,
retardo de disparo y sonido. **Foto de prueba** hace una foto que no entra en la
animación; **Comparar** la pone junto al vivo.

## 4. Capturar

- **Capturar** o `Enter`. `Shift+Enter` reemplaza el fotograma elegido, `Alt+Enter`
  inserta después. **(Estudio)** `Ctrl+2…9` captura un fotograma que dura 2–9 cuadros.
- Mientras se hace una foto, el botón no dispara otra (evita fotos dobles).
- **Intervalómetro** (*Proyecto*): una foto cada N segundos, para time-lapse.
- **Móvil como mando (escritorio)**: *Proyecto › Móvil como mando › Activar*.
  Escanea el QR con el móvil (misma wifi): tendrás Capturar, reproducir,
  anterior/siguiente, vivo, cebolla y deshacer, con la imagen del visor.

### Asistente de rodaje

*Cámara › Asistente de rodaje*. Después de cada foto compara con la anterior y
avisa si la **cámara se movió**, si **cambió la luz**, si **se disparó dos veces**,
si **entró algo por el borde** (una mano, una sombra) o si **se perdió el foco**.
Pulsa **Ver diferencia** para comprobarlo; si fue la luz, **Compensar parpadeo**
activa la estabilización al reproducir y exportar. Con *Vigilar la luz y la
cámara en el vivo* también avisa antes de disparar. **Revisar toda la toma**
repasa todos los fotogramas. El asistente nunca cambia ni borra fotos.
**(Estudio)** La sensibilidad se ajusta en baja, normal o alta.

## 5. Animar

*Animar*:
- **Papel cebolla** (`O`): fotogramas anteriores semitransparentes. En *Más
  opciones*: fotogramas siguientes al revisar, colores por dirección y modos para
  destacar lo claro o lo oscuro.
- **Diferencia** (`D`): en negro lo que no cambió. **Parpadeo** (`B`): alterna vivo
  y última foto. `2` alterna a mano.
- **Croma**: sustituye el fondo verde o azul por una imagen solo en la vista.
- **Color y luz**: brillo, contraste, saturación y **estabilizar la luz
  (deflicker)**. Se aplican al revisar, reproducir y exportar; las fotos no cambian.
- **Superposiciones**: cuadrícula (`G`), máscaras de encuadre, zonas seguras,
  focus peaking (`F`), lupa 1:1 (`Z`) e histograma.

*Guías*: dibuja trayectorias y marcas sobre la vista (no salen en las fotos) y
carga una **referencia** de vídeo o imagen que se reproduce sincronizada.

**Calculadora de espaciado** (*Proyecto*): cuánto mover el objeto en cada
fotograma con aceleración o frenada.

**Segunda pantalla** (icono de monitor arriba): el visor en otra ventana, a
pantalla completa si hay un segundo monitor.

## 6. Timeline y reproducción

- Haz clic en un fotograma para verlo; `5` o **EN VIVO** vuelve a la cámara.
- Arrastra para reordenar; `Ctrl+D` duplica; `Supr` borra (el aviso ofrece
  **Deshacer** y **Ver papelera**); `Ctrl+Z` deshace.
- **Duración** (`+` / `−`): cuántos cuadros dura el fotograma (animar «en doses» = 2).
- **Nota** (`N`): texto en el fotograma, visible en el timeline y el visor.
- Reproducir (`Espacio`), bucle (`L`), ping-pong (`P`), **reproducción corta** (`6`:
  últimos fotogramas y vuelta al vivo). Selector de **fps** (12 es lo habitual).
  **(Estudio)** Velocidad de revisión a ½ o ¼ con el sonido acompasado.
- La rueda del ratón desplaza el timeline; `Ctrl` + rueda hace zoom; arrastrar la
  regla recorre la animación con sonido.

## 7. X-Sheet **(Estudio)**

Una fila por **exposición** (cuadro de la película): tiempo, fotograma, **acción,
diálogo, fonema, cámara, luz** y notas. Lo que escribes en las columnas de
planificación va unido a la exposición, aunque luego insertes o borres
fotogramas. ● marca la siguiente exposición que vas a capturar.
**Exportar CSV** (Excel, Numbers, Google Sheets…), **Importar CSV** con las mismas
columnas e **Imprimir**.

## 8. Audio y lip sync

*Audio › Pistas de audio* › **Añadir audio…** (WAV, MP3, M4A, OGG; varios a la vez).
Cada pista tiene nombre, **Silenciar**, volumen y **Desde exp.** (exposición en la
que empieza a sonar). Las ondas aparecen bajo el timeline con un color por pista.

**Lip sync (Estudio)**:
1. **Nuevo personaje** y pulsa cada casilla de boca para elegir su imagen
   (A·I, E, O, U·W, M·B·P, F·V, L·D·T·N, C·S·R…, reposo).
2. En el X-Sheet escribe en **Fonema** la boca de cada exposición (también vale
   la letra: «b» → M·B·P), o pulsa **Generar borrador de fonemas** con la pista de
   diálogo: rellena las celdas vacías según el volumen (silencio = reposo, antes
   de hablar = labios cerrados, más fuerte = más abierta). Es aproximado: corrígelo.
3. Antes de cada foto el visor muestra la boca que toca.

## 9. Luces DMX y motion control **(Estudio)**

Ambos están desactivados por defecto. Empieza con el **simulador**: funciona igual
pero no envía nada a ningún aparato. Antes de cada foto MESORA pone las luces y
los ejes en su sitio para esa exposición, espera y dispara; si algo falla, no hace
la foto y te dice por qué.

- **Luz**: añade luces (canal DMX), crea **looks** con los niveles de cada luz y
  un **programa** (qué look desde qué exposición, con fundido opcional). Salidas:
  simulador, Art-Net **(escritorio)** o ENTTEC DMX USB Pro.
- **Movimiento**: añade ejes (unidad y pasos del motor por unidad), colócalos con
  **Ir a** y guarda la posición como **clave** en una exposición; elige la curva
  (acelerar, frenar…). La gráfica muestra el recorrido. Controlador: simulador o
  Arduino con el firmware **MESORA-Moco**.

Conexiones, protocolo y seguridad: [luz-y-movimiento.md](luz-y-movimiento.md).

## 10. Exportar

**Exportar** (arriba). Elige *Toda la toma* o *Solo los fotogramas seleccionados*.

- **(escritorio)** **Película**: MP4 (para compartir), ProRes 422 HQ (postproducción)
  o AVI Motion JPEG, a la resolución que quieras, con la mezcla de sonido.
  **Imágenes**: PNG, TIFF o JPEG en una carpeta, repitiendo cada fotograma según
  su duración. **Copiar fotos originales en orden**. Por defecto todo va a la
  carpeta `exports` del proyecto (o marca *Preguntar dónde guardar*).
- Web: vídeo en tiempo real (mantén la pestaña visible) y secuencia ZIP.
- **Otros**: fotograma actual (PNG), **Sonido (WAV)**, **Paquete de revisión** y
  **Copia del proyecto (.mesora)**.

## 11. Revisión con otras personas

**Paquete de revisión**: un único archivo HTML con la toma (y el sonido). Envíalo
por correo o mensajería; quien lo abre (en cualquier navegador, sin instalar nada)
escribe notas por fotograma y pulsa **Descargar mis notas**. Arrastra ese archivo
a MESORA (o *Importar*): cada nota aparece en su fotograma (se puede deshacer) y
una lista con **Ir** te lleva a cada una.

## 12. Copias de seguridad **(escritorio)**

*Proyecto › Copia de seguridad* › **Elegir carpeta…**: un disco externo o una
carpeta de Dropbox, Google Drive, OneDrive o iCloud. Cada 10 minutos MESORA copia
lo nuevo y lo cambiado; nunca borra nada de la copia (las películas exportadas no
se copian). **Copiar ahora** fuerza una copia. Para recuperar una producción,
cópiala de vuelta a `Documentos/MESORA` con MESORA cerrado.

## 13. Atajos

*Ayuda* muestra todos los atajos; **Cambiar** asigna otra tecla y **Restablecer
atajos** vuelve a los de fábrica. Resumen en el [README](../README.md#atajos-principales).

## 14. Si algo falla

- **No veo la cámara**: comprueba que ningún otro programa la esté usando; en la
  web hace falta `https://` o `localhost`.
- **La réflex no manda fotos**: comprueba en su programa oficial la carpeta de
  destino y que sea la misma que elegiste en MESORA.
- **(escritorio)** *Ayuda › Abrir registro de errores* abre el archivo con los
  errores de la app, útil para informar de un problema.
