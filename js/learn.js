// Learning mode: a guided first animation, one small step at a time. Each step
// is done when the app sees it happen (the camera connects, a photo is taken…);
// the ones that only explain something are passed with «Siguiente».

export const LEARN_STEPS = [
  {
    id: 'camera', title: 'Conecta la cámara',
    text: 'Pulsa «Conectar cámara». Sirve una webcam, una cámara USB o tu réflex. Fíjala con un trípode o cinta: no debe moverse en toda la animación.',
    targets: ['#btnStartCam', '#btnCamToggle'], done: (c) => c.cameraReady,
  },
  {
    id: 'first', title: 'Haz tu primera foto',
    text: 'Coloca tu personaje y pulsa el botón rojo «Capturar» (o la tecla Intro).',
    targets: ['#btnCapture'], done: (c) => c.frames >= 1,
  },
  {
    id: 'more', title: 'Mueve un poquito y repite',
    text: 'Mueve el personaje 1 o 2 cm y vuelve a capturar. Saca tus manos del encuadre antes de cada foto. Haz al menos 5.',
    targets: ['#btnCapture'], done: (c) => c.frames >= 5,
  },
  {
    id: 'onion', title: 'Fíjate en el papel cebolla',
    text: 'La foto anterior se ve transparente encima de la cámara: así sabes cuánto has movido. Se activa y desactiva con la tecla O.',
    targets: [], manual: true,
  },
  {
    id: 'play', title: 'Mira tu animación',
    text: 'Pulsa «Reproducir» (o la barra espaciadora).',
    targets: ['#tPlay'], done: (c) => c.played,
  },
  {
    id: 'speed', title: '¿Va muy rápido o muy lento?',
    text: 'Cambia los fotogramas por segundo (12 es lo habitual) o elige un fotograma y pulsa + para que dure más.',
    targets: ['#fpsSelect'], manual: true,
  },
  {
    id: 'export', title: 'Haz tu video',
    text: 'Pulsa «Exportar» para crear la película y compartirla.',
    targets: ['#btnExport'], done: (c) => c.exportOpened,
  },
];

/** First step from `index` that is not done yet (LEARN_STEPS.length when all are). */
export function currentStep(index, ctx) {
  let i = Math.max(0, index);
  while (i < LEARN_STEPS.length && !LEARN_STEPS[i].manual && LEARN_STEPS[i].done(ctx)) i++;
  return i;
}
