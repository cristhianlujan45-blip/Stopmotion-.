# API local de MESORA Studio

La app de escritorio puede abrir un pequeño servidor HTTP en la red local para
que un **móvil haga de mando** (disparar, reproducir, moverse por los
fotogramas) y para que **otros programas** (un pulsador, un script, un
controlador de motion control, Stream Deck…) pidan las mismas acciones.

- Está **apagado** por defecto. Se activa en *Proyecto › Móvil como mando*.
- Cada vez que se activa se crea un **código de acceso nuevo** (aparece en el QR
  y en la dirección). Sin ese código todas las peticiones reciben `403`.
- Escucha en el puerto **8765** (si está ocupado, en otro libre que muestra la app)
  de todas las interfaces de red, para que el móvil lo alcance por wifi. La
  primera vez, Windows o macOS pueden preguntar si se permite el acceso a la red.
- Solo puede ejecutar las acciones de la lista de abajo. **No lee ni cambia
  archivos** y no puede borrar fotogramas.

## Autenticación

Envía el código en la cabecera `X-Mesora-Token` o como parámetro `?t=`.

```
http://192.168.1.20:8765/?t=<código>            → página del mando para el móvil
```

## Endpoints

| Método y ruta | Qué hace |
|---|---|
| `GET /api` | Índice de la API y lista de acciones. |
| `GET /api/state` | Estado actual (ver ejemplo). |
| `POST /api/action` | Ejecuta una acción. Cuerpo JSON: `{"action": "capture"}`. |
| `GET /api/preview.jpg` | Imagen reducida (480 px) del visor. `204` si todavía no hay ninguna: la app solo la prepara mientras algún cliente consulta la API. |

Ejemplo de `GET /api/state`:

```json
{ "project": "Corto", "take": "Escena 010 · Toma 1", "frames": 42, "position": 42,
  "live": true, "playing": false, "fps": 12, "camera": true }
```

`position` es el fotograma mostrado (1 = primero); con `live: true` el visor
muestra la cámara y la siguiente foto será la `frames + 1`.

## Acciones

Los mismos nombres que los atajos de teclado (*Ayuda › Atajos*):

| Acción | Efecto |
|---|---|
| `capture` | Capturar fotograma (como pulsar *Capturar*). |
| `play` | Reproducir / parar. |
| `shortPlay` | Reproducción corta (últimos fotogramas y vivo). |
| `prev`, `next` | Fotograma anterior / siguiente. |
| `first` | Primer fotograma. |
| `live`, `toggleLive` | Ir al vivo / alternar vivo ↔ último fotograma. |
| `undo`, `redo` | Deshacer / rehacer. |
| `onion` | Papel cebolla sí/no. |
| `loop` | Bucle sí/no. |
| `holdMore`, `holdLess` | Alargar / acortar el fotograma seleccionado. |

Respuestas: `200 {"ok": true, "action": "capture"}`; `400` si la acción no está
permitida; `403` sin código válido.

## Ejemplos

```sh
T=el-código-del-QR
curl -H "X-Mesora-Token: $T" http://127.0.0.1:8765/api/state
curl -X POST -H "X-Mesora-Token: $T" -d '{"action":"capture"}' http://127.0.0.1:8765/api/action
```

```python
import json, urllib.request
req = urllib.request.Request("http://127.0.0.1:8765/api/action", method="POST",
    data=json.dumps({"action": "capture"}).encode(), headers={"X-Mesora-Token": T})
print(urllib.request.urlopen(req).read())
```

Código: `electron/core/remote.cjs` (servidor), `electron/remote/page.html`
(página del móvil). Pruebas: `tests/remote.test.js` y la sección 15 de
`tests/e2e/desktop.e2e.cjs`.
