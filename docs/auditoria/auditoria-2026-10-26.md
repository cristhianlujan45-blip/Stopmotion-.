# Auditoría de MESORA Studio frente a Dragonframe

Fecha: 26-10-2026 · Versión auditada: rama principal tras el PR #1 (commit `c3fa647`).

**Método:**
- Lectura del código.
- Ejecución real de la app de escritorio (Electron 45 bajo Xvfb, **sin GPU**: las cifras son pesimistas).
- Mediciones con una toma de 600 fotogramas 1080p.
- Comparación con la documentación oficial de Dragonframe (`docs/investigacion/02-investigacion-tecnica.md`).

Dragonframe sigue sin inspeccionarse en directo.

---

## 1. Veredicto honesto

**Hoy MESORA no es mejor que Dragonframe para una producción profesional.** Le faltan las piezas que un estudio considera imprescindibles:
- control de réflex y cámaras sin espejo con RAW;
- exportación profesional exacta (ProRes, secuencias a carpeta);
- X-Sheet, lip sync con bocas, DMX y motion control.

**Ya es mejor en varios terrenos concretos**, y ahí está el camino para superarlo:

| Dónde MESORA ya gana | Evidencia |
|---|---|
| Precio | Gratis. Dragonframe 2026 cuesta 195 USD solo en licencia de estudiante o docente (uso no comercial); la comercial no figura en su página de precios especiales. Ver [precios especiales](https://www.dragonframe.com/special-pricing/) |
| Plataformas | Windows, Mac, Linux, Android y navegador. Dragonframe: macOS, Windows y Linux [DOC] |
| Primer uso | Guía de 4 pasos, explicaciones en cada panel y opciones avanzadas plegadas |
| Estabilizador de luz (deflicker) integrado | Dragonframe no lo menciona en su página de funciones ni en su historial de versiones |
| Protección del trabajo | Originales inmutables, deshacer desde el aviso, papelera, historial de versiones y recuperación tras un cierre inesperado, con 80 cierres forzados sin perder nada. Dragonframe tiene papelera (`_backup`) [DOC]; su comportamiento ante cierres es [DESC] |

**Conclusión:** para ser *mejor* hay que hacer dos cosas a la vez:
1. **Alcanzar la paridad** en lo que un estudio no negocia (sección 6A).
2. **Ganar claramente** donde Dragonframe es débil o caro (sección 6B), sin perder la facilidad de uso, que hoy es la mayor ventaja de MESORA.

---

## 2. Lo que se midió

| Medida | Resultado | Lectura |
|---|---|---|
| Guardar una captura 1080p (original + vista previa + miniatura) | Mediana 56 ms, p95 71–88 ms, máximo 100–709 ms | Bien para webcam. El pico de 709 ms apareció una vez: hay que vigilarlo con réflex, porque cada foto pesará 25–60 MB |
| Reabrir una toma de 600 fotogramas | Correcto. 5.006 nodos en la página | El timeline crea un elemento por fotograma; con más de 5.000 fotogramas se notará |
| Reproducción 12 fps, 10 s | 120/120 fotogramas, 0 saltados, 0 imágenes sin cargar | Perfecto |
| Reproducción 24 fps, 10 s | 239/240, 1 saltado, 1 imagen sin cargar | Aceptable sin GPU; falta medir 4K y con GPU |
| Memoria | ≈ 1 GB en total entre procesos (ventana ≈ 475 MB) | Alto para una tablet, normal para una estación de animación |
| Disco | 600 fotogramas ≈ 50 MB | Depende de la cámara |

---

## 3. Qué QUITARÍA

1. **La exportación de vídeo en tiempo real en escritorio** (`js/exporter.js`, MediaRecorder).
   - Graba mientras reproduce, así que tarda lo mismo que la película y depende de que no se pierdan fotogramas.
   - El aviso «mantén esta pestaña visible» no tiene sentido en una app de escritorio.
   - Dragonframe exporta MOV ProRes, Animation, Photo JPEG, AVI y MP4 [DOC].
   - Sustituirla por un render fuera de tiempo real con FFmpeg. La web puede conservar la actual.
2. **El `.mesora` como forma principal de mover proyectos en escritorio.** El proyecto ya *es* una carpeta. Dejarlo como «Exportar copia» y quitarlo de la pantalla principal de Proyectos.
3. **El botón «Importar .mesora» duplicado** dentro de Proyectos, porque «Importar» de la barra superior ya acepta `.mesora`. Un solo lugar para importar.
4. **La paridad total en Android y web.** Mantener las tres versiones con todas las funciones divide el esfuerzo. Propuesta:
   - **MESORA Studio** (escritorio) como producto profesional.
   - **MESORA Go** (Android y web) como versión ligera y como *compañera*: mando remoto, segunda cámara, revisión.

---

## 4. Qué CAMBIARÍA

1. **Organización de la interfaz.** Hoy son 4 pestañas laterales con 15 secciones plegables, y funciones clave quedan escondidas: los **fps** están en *Herramientas › Proyecto* y la **papelera** también. Dragonframe separa por espacios de trabajo [DOC]. Propuesta:
   - Espacios: **Animar · Cámara · Timeline/X-Sheet · Audio · Luz · Movimiento · Exportar**.
   - Un interruptor **«Modo sencillo / Modo estudio»**. El sencillo es la MESORA actual, que no se pierde; el de estudio muestra todo.
   - Esa es la manera de ser más potente que Dragonframe sin ser más difícil.
2. **Los fps** pasan a la barra del timeline, con 8, 10, 12, 15, **18**, 24, 25, 30 y **personalizado**; hoy faltan 18 y personalizado. Además, se separan el fps del proyecto y la velocidad de revisión, como hace Dragonframe [DOC].
3. **El visor**, de Canvas 2D en CPU a **WebGL2**.
   - Croma, histograma y peaking recorren los píxeles en JavaScript (`js/viewer.js`, hacia la línea 113).
   - A 4K y con live view de réflex no aguantará. En GPU, onion skin, diferencia, croma, claros y oscuros prominentes y peaking cuestan casi nada.
4. **`js/app.js`** (2.320 líneas, 126 funciones en un archivo) se divide por módulos: captura, reproducción, timeline, proyectos, audio, atajos. No cambia nada para el usuario, pero sin esto cada etapa siguiente será más lenta y más arriesgada.
5. **El timeline:** números de fotograma visibles, miniaturas más grandes, y virtualización para tomas de más de 5.000 fotogramas (hoy hay un elemento por fotograma).

---

## 5. Qué MEJORARÍA

1. **Reproducción en alta calidad.** La caché guarda 72 vistas previas de 1.280 px como máximo; Dragonframe reproduce desde proxies `hq` [DOC]. Propuesta:
   - Caché adaptativa a la RAM.
   - Proxies de 1080p y 2K en disco.
   - Decodificación en segundo plano (Workers).
   - Prueba de aceptación: 24 fps estables a 2K.
2. **Instalador profesional.**
   - **Firmarlo** (hoy Windows muestra «Windows protegió su PC»).
   - **Actualizaciones automáticas.** Dragonframe distribuye actualizaciones continuas [DOC: historial].
3. **Seguridad de Electron:** añadir una política de seguridad de contenido (CSP), que `index.html` no tiene.
4. **Diagnóstico:** un registro local de errores y avisos, para soporte y para encontrar fallos reales en producción.
5. **Pruebas:**
   - La E2E corre solo en Linux: añadirla en **Windows** (plataforma principal) y macOS.
   - Añadir pruebas del visor (píxel a píxel) y una prueba de rendimiento en CI que avise si la reproducción baja de 24 fps.
6. **Licencia del proyecto.** No hay ninguna. Hay que elegirla antes de integrar FFmpeg y los SDK de cámara.
7. **Inglés.** Toda la interfaz está escrita en español dentro del código. Para competir con Dragonframe hace falta al menos inglés, con los textos separados en un archivo de idioma.

---

## 6. Qué AÑADIRÍA

### 6A. Paridad imprescindible: sin esto ningún estudio cambia

| # | Función | Dragonframe [DOC] | Por qué es bloqueante |
|---|---|---|---|
| 1 | **Control de réflex y cámaras sin espejo** (Canon EDSDK primero), **RAW + JPEG**, live view y ajustes | Soporte amplio y recomendado | Es la razón de ser de Dragonframe. Una webcam no es una cámara de cine |
| 2 | **Video assist + alta calidad en paralelo** | Su modelo base | Animar con el vídeo y entregar en RAW |
| 3 | **Carpeta vigilada** (cualquier cámara con su software de tethering) | Sí | Vía real con cualquier marca mientras llegan los SDK |
| 4 | **Exportación fuera de tiempo real**: ProRes, PNG o TIFF a carpeta, MP4, WAV | Sí | La entrega a postproducción |
| 5 | **X-Sheet** sincronizado con el timeline | Sí | Planificación profesional |
| 6 | **Lip sync**: personajes, juegos de bocas, track reading | Sí | Diálogo |
| 7 | **Atajos configurables y mando o teclado numérico** | Keypad propio | Velocidad de trabajo del animador |
| 8 | **Segundo monitor** | Sí | Estudio |
| 9 | **DMX** (ENTTEC y Art-Net) y **motion control** (Arduino) | Sí | Estudios medianos y grandes |

### 6B. Para SUPERAR a Dragonframe: donde puede ganar con claridad

| # | Idea | Por qué gana |
|---|---|---|
| 1 | **Asistente inteligente que avisa, nunca toca**: golpe de cámara o del set, parpadeo de luz, fotograma duplicado u olvidado, mano en el plano, salto de enfoque. Aviso inmediato tras cada disparo | No aparece en la documentación ni en el historial de versiones revisados de Dragonframe. Evita repetir tomas enteras |
| 2 | **Deflicker en vivo en la captura**, no solo al exportar | Ya existe la base (`js/grading.js`) |
| 3 | **El móvil como compañero**: mando de disparo por wifi, segunda cámara (making-of, cenital) y monitor del director | MESORA ya funciona en Android. Dragonframe usa su keypad físico o su mando Bluetooth, que se venden aparte [DOC] |
| 4 | **Revisión y aprobación compartida**: enlace para que el director vea la toma y deje notas por fotograma, que aparecen en el X-Sheet | Flujo de estudio moderno, sin herramientas externas |
| 5 | **Modo aprendizaje**: guías de los 12 principios (espaciado, arcos, timing) superpuestas, ejercicios y la calculadora de espaciado ya existente | Escuelas: el mercado al que Dragonframe vende licencias de estudiante a 195 USD |
| 6 | **Copias de seguridad automáticas** a un segundo disco o a la nube del usuario mientras se anima | Para estudios, perder un día de rodaje es caro |
| 7 | **Formatos abiertos y automatización**: proyecto en JSON legible, API local y scripts | Integración con pipelines (Blender, After Effects, Nuke) |
| 8 | **Precio**: gratis para estudiantes y uso personal | Barrera de entrada cero |

---

## 7. Plan priorizado

Cada paso deja una versión instalable y verificada, como hasta ahora.

| Orden | Entrega | Criterio de «hecho» |
|---|---|---|
| 1 | Licencia del proyecto + instalador firmado + actualizaciones automáticas + CSP + registro de errores | Instalar sin el aviso de Windows y recibir una actualización |
| 2 | Visor WebGL2 + reproducción HQ + fps en el timeline (18 y personalizado) | 24 fps estables a 2K con GPU; pruebas de píxel |
| 3 | **Etapa 7 · Cámara**: carpeta vigilada → Canon EDSDK → video assist + HQ, RAW | Captura RAW real con una Canon, desconexión y reconexión sin perder nada |
| 4 | Exportación FFmpeg (ProRes, PNG o TIFF a carpeta, MP4, WAV) | `ffprobe`: número exacto de fotogramas y duración |
| 5 | Espacios de trabajo + modo sencillo/estudio + X-Sheet | Prueba de uso: una persona nueva anima 3 s sin ayuda en menos de 10 min |
| 6 | Asistente inteligente (avisos tras cada disparo) + deflicker en vivo | Detecta un golpe de 2 px y un salto de exposición del 5 % |
| 7 | Móvil como mando y segunda cámara | Disparar desde el móvil con < 300 ms de latencia |
| 8 | Lip sync, audio multipista, DMX, motion control | Pruebas de la matriz de equivalencia |
| 9 | Inglés | 100 % de los textos traducidos |

### Cómo medir «mejor que Dragonframe»
- **Tiempo hasta la primera animación** desde la instalación: menos de 5 min.
- **Fotos perdidas** en cierres forzados: 0 (ya se cumple).
- **Cámaras compatibles** en la lista oficial.
- **Formatos de exportación** iguales o más.
- **Errores de continuidad** detectados automáticamente.
- **Precio para estudiantes:** 0 frente a 195 USD.

---

## 8. Decisiones que necesito del usuario

1. **Licencia del proyecto** (libre/GPL, libre/MIT o propietaria). Decide los códecs de FFmpeg y el modelo de negocio.
2. **Certificado de firma de código para Windows.** Es de pago (a nombre del autor o de la empresa) y lo tiene que contratar el usuario.
3. **Cámara principal** de producción y registro en su SDK (Canon, Sony o Nikon).
4. **Estrategia de plataformas:** ¿escritorio como producto profesional y Android/web como «compañero»?
