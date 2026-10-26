# Etapa 1 · Inspección directa de Dragonframe

**Estado: NO REALIZADA. No ha sido posible acceder al Dragonframe instalado.**

Este documento deja constancia de por qué, de qué se comprobó y del protocolo que se seguirá en cuanto haya acceso. Ninguna parte del resto de la investigación se presenta como observación directa del programa.

## 1. Qué se comprobó (26-10-2026)

| Comprobación | Resultado |
|---|---|
| Entorno de esta sesión | Contenedor Linux en la nube (Ubuntu 24.04, x86_64), sin pantalla (`DISPLAY` vacío) |
| Búsqueda de archivos `*dragonframe*` en el sistema | Ninguno |
| Archivos subidos o adjuntos (`/mnt/user-data/uploads`, `/mnt/attach`) | Vacíos |
| Herramientas de control de escritorio (Computer Use) en la sesión | No disponibles |
| Conexión con el equipo del usuario (Remote Control / dispositivo vinculado) | No disponible |

**Conclusión:** Dragonframe está instalado en el equipo del usuario, que es una máquina distinta de la que ejecuta esta sesión. No se ha abierto, ni visto, ni probado. No existen capturas de pantalla del programa original en este repositorio.

## 2. Cómo habilitar la inspección

Cualquiera de estas opciones lo permite:

1. **Claude Desktop con Computer Use** en el equipo donde está instalado Dragonframe: *Ajustes → Este ordenador → Computer use* (desactivado por defecto). Después, abrir una conversación nueva desde la app de escritorio.
2. **Sesión local de Claude Code** en ese equipo (`claude remote-control` en una terminal dentro de la carpeta del proyecto, o la app de escritorio). Así la sesión ve el disco y las ventanas de ese equipo.
3. **Material aportado por el usuario**, sin acceso remoto. Ver la lista de la sección 5.

## 3. Reglas de seguridad para la inspección (cuando haya acceso)

- Trabajar **solo** en una producción temporal nueva, en una carpeta propia (`C:\MESORA-inspeccion\` o equivalente). No abrir proyectos existentes del usuario más que en modo lectura y, si se abren, no guardar.
- **No capturar** con una cámara física, **no mover** motores, ni encender luminarias DMX sin autorización expresa y explícita en ese momento.
- Para las pruebas de captura usar, en este orden: importación de imágenes, una webcam (avisando de que no equivale a una réflex), o la cámara solo si el usuario lo autoriza.
- No modificar Preferencias globales sin anotar antes el valor original y restaurarlo al terminar.
- No examinar ni intentar sortear la activación o licencia. No descompilar binarios: el objetivo es el **comportamiento observable**, no el código.

## 4. Protocolo de inspección por secciones

Por cada herramienta se rellenará esta ficha (plantilla en `fichas/_plantilla.md` cuando empiece la inspección):

```
Herramienta:         Nombre exacto en la interfaz
Ubicación:           Espacio de trabajo › panel › menú
Función:             Para qué sirve
Comportamiento:      Qué ocurre al usarla (observado)
Controles:           Botones, deslizadores, atajos
Parámetros:          Rango, valores por defecto, unidades
Prueba realizada:    Pasos exactos y resultado observado
Dependencias:        Hardware, otros módulos
Relación:            Con qué módulos se sincroniza
Captura:             capturas/<seccion>-<n>.png
Propuesta MESORA:    Cómo se implementará (enlace a la matriz)
```

Orden previsto (de menor a mayor riesgo):

1. **Ayuda › Acerca de**: versión exacta y plataforma.
2. **Menús completos**: un recorrido con captura de cada menú desplegado.
3. **Preferencias y Ajustes de escena**: todas las pestañas, sin cambiar nada.
4. **Atajos de teclado**: lista completa (Dragonframe permite exportarlos o verlos en la ventana de atajos).
5. Espacios de trabajo **Animation, Cinematography, Audio, DMX, Arc Motion Control** y el **X-Sheet**: paneles, barras de herramientas y menús contextuales.
6. **Pruebas sin hardware**, sobre una producción temporal:
   - Importar una secuencia de imágenes de prueba (Scene › Import).
   - Avanzar y retroceder, reproducir, bucle, reproducción corta.
   - Onion skin: opacidad, número de fotogramas, modos (diferencia, claros u oscuros prominentes).
   - Timeline: mover, mantener (hold), cortar, pegar, borrar y recuperar desde la papelera.
   - X-Sheet: notas, longitud de escena, exportar CSV.
   - Audio: importar un WAV de prueba, forma de onda, track reading con un juego de caras de prueba.
   - Capas de dibujo, guías y referencias.
   - Exportar película e imagen en secuencia: anotar formatos y opciones de cada diálogo.
   - Observar en el Explorador de archivos la estructura de carpetas que genera la producción temporal.
7. **Pruebas con hardware**, solo con autorización: captura con cámara, DMX y Arc.

## 5. Qué puede aportar el usuario sin acceso remoto

Esto adelanta mucho trabajo y evita suposiciones:

- Versión de Dragonframe (*Help › About*).
- El archivo **`DFMoco_Protocol.rtf`**, que el propio Dragonframe instala en `[carpeta de instalación]/Resources/Arc Motion Control/DFMoco/` según su FAQ oficial. Es la especificación oficial del protocolo para Arduino.
- Capturas de pantalla de cada espacio de trabajo y de los diálogos de Exportar, Preferencias y Ajustes de escena.
- Un listado (sin contenido) de la estructura de carpetas de una toma de prueba, por ejemplo con `tree /F` en Windows.
- Modelo de cámara, interfaz DMX y hardware de motion control que se usarán en producción.
