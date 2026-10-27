// MESORA-Moco: firmware para mover motores paso a paso desde MESORA Studio
// (move · shoot · move). Para Arduino Uno/Nano/Mega con drivers STEP/DIR
// (A4988, DRV8825, TMC2208…), por ejemplo sobre una «CNC shield».
//
// Protocolo (líneas de texto terminadas en \n, 115200 baudios), descrito
// también en docs/luz-y-movimiento.md:
//   hi                  -> MESORA-MOCO 1 axes=3
//   go <p1> <p2> <p3>   -> ok go   ... y al parar todos los ejes: done <p1> <p2> <p3>
//   pos                 -> pos <p1> <p2> <p3>
//   zero                -> ok zero        (la posición actual pasa a ser 0)
//   spd <pasos/s> <pasos/s2> -> ok spd
//   stop                -> ok stop + done <p1> <p2> <p3>
// Posiciones absolutas en pasos. Cualquier otra cosa -> err <motivo>.
//
// Licencia: GPL-3.0-or-later, como el resto de MESORA Studio.

const uint8_t AXES = 3;
const uint8_t STEP_PIN[AXES] = {2, 3, 4};  // X, Y, Z de una CNC shield
const uint8_t DIR_PIN[AXES] = {5, 6, 7};
const uint8_t ENABLE_PIN = 8;               // LOW = drivers activados
const float MIN_SPEED = 50.0;               // pasos/s al arrancar y al final

long pos[AXES];
long target[AXES];
float speed[AXES];
unsigned long nextStepAt[AXES];
float maxSpeed = 2000.0;
float accel = 4000.0;
bool moving = false;

char line[96];
uint8_t len = 0;

void reportPositions(const char *word) {
  Serial.print(word);
  for (uint8_t i = 0; i < AXES; i++) {
    Serial.print(' ');
    Serial.print(pos[i]);
  }
  Serial.print('\n');
}

void startMove() {
  unsigned long now = micros();
  for (uint8_t i = 0; i < AXES; i++) {
    speed[i] = MIN_SPEED;
    nextStepAt[i] = now;
  }
  moving = true;
}

void stepMotors() {
  if (!moving) return;
  unsigned long now = micros();
  bool any = false;
  for (uint8_t i = 0; i < AXES; i++) {
    long remaining = target[i] - pos[i];
    if (remaining == 0) continue;
    any = true;
    if ((long)(now - nextStepAt[i]) < 0) continue;
    digitalWrite(DIR_PIN[i], remaining > 0 ? HIGH : LOW);
    digitalWrite(STEP_PIN[i], HIGH);
    delayMicroseconds(3);
    digitalWrite(STEP_PIN[i], LOW);
    pos[i] += remaining > 0 ? 1 : -1;
    // Rampa trapezoidal: frena cuando los pasos que quedan no superan la
    // distancia de frenado v²/2a; si no, acelera. Cada paso dura 1/v, así que
    // la velocidad cambia a·(1/v) por paso.
    long left = labs(remaining) - 1;
    float braking = speed[i] * speed[i] / (2.0 * accel);
    float dv = accel / max(speed[i], MIN_SPEED);
    if (braking >= left) speed[i] = max(speed[i] - dv, MIN_SPEED);
    else speed[i] = min(speed[i] + dv, maxSpeed);
    nextStepAt[i] = now + (unsigned long)(1000000.0 / speed[i]);
  }
  if (!any) {
    moving = false;
    reportPositions("done");
  }
}

void handle(char *cmd) {
  char *word = strtok(cmd, " ");
  if (!word) return;
  if (!strcmp(word, "hi")) {
    Serial.print("MESORA-MOCO 1 axes=");
    Serial.print(AXES);
    Serial.print('\n');
  } else if (!strcmp(word, "pos")) {
    reportPositions("pos");
  } else if (!strcmp(word, "zero")) {
    if (moving) { Serial.print("err moviendo\n"); return; }
    for (uint8_t i = 0; i < AXES; i++) pos[i] = target[i] = 0;
    Serial.print("ok zero\n");
  } else if (!strcmp(word, "spd")) {
    char *a = strtok(NULL, " ");
    char *b = strtok(NULL, " ");
    if (!a || !b || atol(a) <= 0 || atol(b) <= 0) { Serial.print("err spd necesita velocidad y aceleracion\n"); return; }
    maxSpeed = max((float)atol(a), MIN_SPEED);
    accel = (float)atol(b);
    Serial.print("ok spd\n");
  } else if (!strcmp(word, "stop")) {
    for (uint8_t i = 0; i < AXES; i++) target[i] = pos[i];
    moving = false;
    Serial.print("ok stop\n");
    reportPositions("done");
  } else if (!strcmp(word, "go")) {
    if (moving) { Serial.print("err moviendo\n"); return; }
    long next[AXES];
    for (uint8_t i = 0; i < AXES; i++) {
      char *v = strtok(NULL, " ");
      char *end;
      if (!v) { Serial.print("err orden no valida: faltan posiciones\n"); return; }
      next[i] = strtol(v, &end, 10);
      if (*end) { Serial.print("err orden no valida: posicion\n"); return; }
    }
    if (strtok(NULL, " ")) { Serial.print("err orden no valida: sobran posiciones\n"); return; }
    for (uint8_t i = 0; i < AXES; i++) target[i] = next[i];
    Serial.print("ok go\n");
    startMove();
  } else {
    Serial.print("err orden no valida: ");
    Serial.print(word);
    Serial.print('\n');
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[len] = 0;
      handle(line);
      len = 0;
    } else if (len < sizeof(line) - 1) {
      line[len++] = c;
    } else {
      len = 0;
      Serial.print("err linea demasiado larga\n");
    }
  }
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < AXES; i++) {
    pinMode(STEP_PIN[i], OUTPUT);
    pinMode(DIR_PIN[i], OUTPUT);
    pos[i] = target[i] = 0;
  }
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, LOW);
}

void loop() {
  readSerial();
  stepMotors();
}
