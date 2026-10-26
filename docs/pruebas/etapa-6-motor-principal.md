# Informe de pruebas · Etapa 6 · Motor principal

Fecha: 26-10-2026 · Entorno: Linux x86_64 (contenedor), Node 22.22 para las pruebas unitarias, Electron 45.0.0 (Node 24.22, Chromium 156) bajo Xvfb para la E2E.

## Qué se entrega

En la **app de escritorio**, los proyectos dejan IndexedDB y pasan a **carpetas de producción en disco**: `Documentos/MESORA/<Producción>/scenes/scNNN/takes/tkNN/`. El diseño está en `docs/investigacion/04-arquitectura.md` §3.3.

- Producción › Escena › Toma: nueva toma, nueva escena (copia ajustes) y duplicar escena (copia completa).
- Originales inmutables con escritura segura. Edición virtual, **papelera** con restauración, **historial** del timeline y **conform**.
- Recuperación ante cierres inesperados.
- Migración automática de los proyectos guardados con versiones anteriores, sin tocar el original.
- Web y Android siguen con IndexedDB a través de la misma interfaz (`js/library.js`).

## Cómo repetir las pruebas

```bash
npm ci
npm test                                   # unitarias + prueba de no pérdida
npm run build:web && xvfb-run -a npm run test:e2e   # app de escritorio real (en Windows/macOS: npm run test:e2e)
```

La CI de GitHub ejecuta ambas en cada push (el trabajo `e2e-desktop` es nuevo).

## Resultados

### Unitarias (`npm test`): 26 de 26 pasan
13 eran las existentes (grading, timing, zip) y 13 son nuevas en `tests/library.test.js`:

| Prueba | Resultado |
|---|---|
| Crea la estructura producción › escena › toma; nombres de carpeta únicos | ✅ |
| Las capturas se guardan con los bytes exactos (SHA-256) y nunca se sobrescriben; la numeración continúa tras reabrir | ✅ |
| Borrar es virtual: la papelera conserva el original; cerrar, reabrir y restaurar | ✅ |
| Holds, notas, ajustes, fps y nombre se guardan en el nivel correcto | ✅ |
| Rechaza guardar un timeline con capturas inexistentes (protege la toma) | ✅ |
| Recupera capturas escritas antes de un cierre: van al final con nota; los `.partial` se informan y no se borran; no duplica al reabrir | ✅ |
| Reabrir en la misma sesión no confunde capturas sin guardar con huérfanas | ✅ |
| Nueva toma (vacía, con los ajustes de la escena), toma duplicada y escena duplicada independientes | ✅ |
| Conform en orden de timeline con holds; originales intactos (hash) | ✅ |
| Historial: versión anterior a un borrado y restauración | ✅ |
| Medios (audio, referencias) con bytes exactos | ✅ |
| No abre producciones de una versión futura | ✅ |
| **No pérdida:** 20 rondas en las que un proceso captura y guarda sin parar y se mata con `SIGKILL` en un momento aleatorio | ✅ |

La prueba de no pérdida se ejecutó **4 veces** en esta sesión (80 rondas en total). En todas, cada captura confirmada estaba en el disco con su hash y aparecía **exactamente una vez** en el timeline.

### Extremo a extremo en Electron (`npm run test:e2e`): 31 de 31 comprobaciones pasan
Usa la cámara falsa de Chromium, una biblioteca y un perfil temporales.

1. Los controles de producción en disco están visibles y el primer arranque crea `sc010/tk01`.
2. **Migración**:
   - Un proyecto antiguo sembrado en IndexedDB (3 fotogramas, uno repetido, con hold 2, nota y audio) aparece como carpeta.
   - Tiene 2 originales, conserva orden, holds, notas y audio, y queda marcado como completo.
   - El original sigue en IndexedDB y no se migra dos veces.
3. Nueva producción desde la interfaz (24 fps) y **3 capturas** con la cámara: 3 archivos `sc010_tk01_X1_c00000N.jpg` y 3 fotogramas en `edl.json`. La cabecera muestra «Escena 010 · Toma 1».
4. **Borrar** el fotograma 2: 2 en el timeline, 3 originales en el disco.
5. **Papelera**: muestra `c000002`; «Restaurar» devuelve 3 fotogramas.
6. **Historial**: contiene la versión de 3 fotogramas anterior al borrado.
7. **Conform**: 3 imágenes numeradas en `exports/`.
8. **Cerrar y reabrir**: se abre la misma toma con 3 fotogramas y la vista previa se lee del disco. Sin errores en la consola.

Revisión de facilidad de uso (añadida tras la integración):

9. Al borrar, el aviso ofrece **«Deshacer»** (comprobado: devuelve el fotograma también en el disco) y **«Ver papelera»**.
10. **Proyectos** agrupa por proyecto: la toma abierta está marcada y su botón dice «Abierta».
11. Menú **⋯ › Nueva toma de esta escena**: abre «Escena 010 · Toma 2», vacía y con los 24 fps de la escena.
12. Pulsar la etiqueta «Escena · Toma» abre la lista. Se vuelve a la toma 1 con sus 3 fotogramas.
13. Con una sola toma, el menú dice **«Eliminar proyecto»** y la carpeta va a la papelera del sistema (comprobado en este entorno).

Capturas de la ejecución: `capturas/mesora-escritorio-produccion.png`, `capturas/mesora-escritorio-papelera.png` y `capturas/mesora-escritorio-proyectos.png`.

### Versión web (regresión, manual con Playwright)
Cámara falsa: 3 capturas → recargar → 3 fotogramas, sin errores. Los controles de disco no aparecen en la web.

## Limitaciones conocidas (no ocultas)

- **Probado en Linux, no en Windows.** El código prevé las diferencias (sin `fsync` de directorios, `link()` en NTFS, papelera del sistema), pero la primera verificación real en Windows será la de la CI (el instalador se compila) y la del usuario. La E2E **no** corre todavía en Windows en la CI.
- **Unidades FAT32/exFAT:** sin enlaces duros, el «no sobrescribir» se hace comprobando antes de renombrar. Es seguro con un solo proceso escritor, que es el diseño, pero no es atómico frente a otro programa que escriba el mismo nombre a la vez.
- **Papelera del sistema:** «Eliminar proyecto» se comprobó en Linux; en Windows (Papelera de reciclaje) falta la comprobación real.
- **Nueva escena y duplicar escena:** el núcleo está probado; sus botones de la interfaz aún no tienen prueba E2E. «Nueva toma» sí la tiene.
- **Cámara:** sigue siendo solo `getUserMedia` (webcam, UVC, HDMI). Las capturas de réflex con SDK y los RAW son la etapa 7.
- **Medios reemplazados** (audio, referencias, fondos) no se borran en disco: se quedan en `media/`, porque otra escena puede usarlos. Ocupa espacio; un limpiador seguro queda pendiente.
- **Rendimiento con tomas muy largas:** `edl.json` se reescribe entero en cada guardado (≈ 60 bytes por fotograma). No se ha medido con más de unos pocos fotogramas; la prueba con 10.000 queda pendiente para la etapa 9.
