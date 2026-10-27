# Luz (DMX) y motion control

Modo **Estudio** › pestañas **Luz** y **Movim.** Ambas están **desactivadas**
por defecto: MESORA no envía nada a ningún aparato hasta que eliges una salida
(y, con USB, pulsas «Conectar»). Para aprender o preparar un plano sin aparatos
están los **simuladores**, que se comportan igual (los movimientos tardan lo que
tardarían con motores) pero no mueven ni encienden nada.

## Cómo funciona antes de cada foto

Al pulsar *Capturar*, MESORA calcula la exposición que va a ocupar la foto y:

1. envía a las luces los niveles de esa exposición;
2. mueve cada eje a su posición para esa exposición y **espera a que paren**;
3. espera el tiempo de estabilización de la luz (por defecto 300 ms);
4. hace la foto.

Si algo falla (controlador desconectado, sin respuesta…) **la foto no se hace**
y aparece el motivo. Después de cada foto, luces y ejes ya van a la posición de
la siguiente mientras animas. Con una cámara de fotos en carpeta vigilada
(disparas tú desde su programa), MESORA prepara el set para la siguiente foto en
cuanto llega la anterior; el visor muestra «Moviendo…» mientras tanto.

## Luz (DMX)

- **Luces**: nombre, canal DMX (1–512) y color (solo para la vista).
- **Looks**: un nivel (0–100 %) para cada luz: «día», «noche», «tormenta»…
- **Programa**: qué look tiene el set desde una exposición. Con *Fundido*, el
  cambio se reparte entre la clave anterior y esta (exposición a exposición).

Salidas:

| Salida | Detalle |
|---|---|
| Simulador | Solo la vista de luces de la pestaña. |
| Art-Net (escritorio) | Paquete ArtDmx por UDP al puerto 6454 de la IP indicada (un nodo o `255.255.255.255`), universo configurable. |
| ENTTEC DMX USB Pro | Por USB serie (Web Serial), mensaje «Output Only Send DMX Packet» (label 6), 512 canales. |

## Motion control

- **Ejes**: nombre, unidad (mm, grados…) y **pasos por unidad** del motor
  (por ejemplo 80 pasos/mm en un carro con correa GT2 y 1/16 de micropaso).
- **Claves**: posición de cada eje en una exposición. Entre claves, el recorrido
  sigue la curva elegida (constante, acelerar, frenar, acelerar y frenar…), con
  una gráfica para verlo antes de rodar.
- Colocación: «Ir a» mueve un eje ahora; «Guardar posición como clave» guarda
  dónde están todos los ejes en la siguiente exposición.

### Controlador MESORA-Moco (Arduino)

Firmware propio en `firmware/mesora-moco/mesora-moco.ino` (GPL-3.0-or-later),
para Arduino Uno/Nano/Mega con drivers STEP/DIR (A4988, DRV8825, TMC2208…), por
ejemplo sobre una *CNC shield*:

| Eje | STEP | DIR |
|---|---|---|
| 1 | D2 | D5 |
| 2 | D3 | D6 |
| 3 | D4 | D7 |

`D8` = ENABLE (LOW activa los drivers). Rampa trapezoidal de aceleración por eje.

Protocolo (texto, líneas terminadas en `\n`, 115200 baudios):

| Orden | Respuesta |
|---|---|
| `hi` | `MESORA-MOCO 1 axes=3` |
| `go <p1> <p2> <p3>` | `ok go` y, cuando paran todos los ejes, `done <p1> <p2> <p3>` |
| `pos` | `pos <p1> <p2> <p3>` |
| `zero` | `ok zero` (la posición actual pasa a ser 0) |
| `spd <pasos/s> <pasos/s²>` | `ok spd` |
| `stop` | `ok stop` y `done …` |
| otra cosa | `err <motivo>` (también `err moviendo` si llega un `go` antes de terminar) |

Posiciones absolutas en pasos. El protocolo es abierto: cualquier controlador que
responda igual funciona con MESORA (y otros programas pueden usarlo).

### Seguridad

- Prueba primero cada plano con el **simulador** y después con el motor a poca
  velocidad.
- El firmware **no tiene finales de carrera** ni vuelta a casa automática: la
  posición 0 es donde estaba el eje al encenderlo o al pulsar «Poner a cero».
  Coloca los ejes a mano antes de empezar y deja margen en los extremos.
- Ten a mano el interruptor de la fuente de los motores.

## Qué se ha verificado y qué no

| Parte | Verificación |
|---|---|
| Niveles por exposición, fundidos, paquetes Art-Net y ENTTEC | Pruebas unitarias (`tests/rig.test.js`). |
| Envío Art-Net real por UDP | Prueba unitaria y E2E: los paquetes se reciben en un socket de **este mismo ordenador** (127.0.0.1). No se ha probado con luces ni nodos reales. |
| ENTTEC DMX USB Pro | Formato del paquete probado; **no probado con el aparato**. |
| Protocolo MESORA-Moco en el ordenador (host) | Pruebas con el simulador (`tests/rig.test.js`) y E2E en la app: espera al movimiento antes de la foto, posición calculada con la curva. |
| Firmware | Compilado con el compilador del sistema y ejecutado con un **Arduino simulado** (puerto serie, pines y reloj falsos): protocolo, un pulso por paso, dirección, rampa, límite de velocidad, `stop` a mitad (`firmware/mesora-moco/test/harness.cpp`, `tests/firmware.test.js`). **No se ha compilado con el compilador de Arduino ni probado en una placa con motores.** |
| Compatibilidad con controladores de otros programas (p. ej. DFMoco de Dragonframe) | **No implementada.** MESORA usa su propio protocolo, documentado arriba. |
