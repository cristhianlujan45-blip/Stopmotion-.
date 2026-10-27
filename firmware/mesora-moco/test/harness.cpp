// Runs the MESORA-Moco sketch on a computer with a fake Arduino (serial port,
// pins and clock), to check the protocol and the motion without a board.
// Build: c++ -std=c++17 -O1 harness.cpp -o harness && ./harness
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>

#define HIGH 1
#define LOW 0
#define OUTPUT 1
template <class T> T max(T a, T b) { return a > b ? a : b; }
template <class T> T min(T a, T b) { return a < b ? a : b; }

static unsigned long clockUs = 0;
static int pinState[64];
static long pulses[64];
static long lastPulseAt[64];
static long shortestGap[64];
static long longestGap[64];

unsigned long micros() { return clockUs; }
void delayMicroseconds(unsigned int us) { clockUs += us; }
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t pin, uint8_t v) {
  if (v == HIGH && pinState[pin] == LOW) {
    if (pulses[pin] > 0) {
      long gap = (long)clockUs - lastPulseAt[pin];
      if (!shortestGap[pin] || gap < shortestGap[pin]) shortestGap[pin] = gap;
      if (gap > longestGap[pin]) longestGap[pin] = gap;
    }
    pulses[pin]++;
    lastPulseAt[pin] = (long)clockUs;
  }
  pinState[pin] = v;
}

struct FakeSerial {
  std::deque<char> in;
  std::string out;
  void begin(long) {}
  int available() { return (int)in.size(); }
  int read() { char c = in.front(); in.pop_front(); return c; }
  void print(const char *s) { out += s; }
  void print(char c) { out += c; }
  void print(long v) { out += std::to_string(v); }
  void print(int v) { out += std::to_string(v); }
  void print(unsigned char v) { out += std::to_string((int)v); }
} Serial;

#include "../mesora-moco.ino"

static int failures = 0;
static void check(bool ok, const char *what, const std::string &detail = "") {
  printf("%s %s%s%s\n", ok ? "OK" : "FALLO", what, detail.empty() ? "" : ": ", detail.c_str());
  if (!ok) failures++;
}

// Sends a line and runs the loop (advancing the clock) until `until` appears in the output.
static std::string talk(const char *cmd, const char *until, unsigned long maxUs = 20000000) {
  Serial.out.clear();
  for (const char *p = cmd; *p; p++) Serial.in.push_back(*p);
  Serial.in.push_back('\n');
  unsigned long start = clockUs;
  while (Serial.out.find(until) == std::string::npos && clockUs - start < maxUs) {
    loop();
    clockUs += 5;
  }
  return Serial.out;
}

int main() {
  setup();
  check(talk("hi", "\n") == "MESORA-MOCO 1 axes=3\n", "saludo");
  check(talk("spd 4000 8000", "\n") == "ok spd\n", "velocidad");

  unsigned long t0 = clockUs;
  std::string r = talk("go 4000 -1500 0", "done");
  check(r == "ok go\ndone 4000 -1500 0\n", "mover y avisar al parar", r);
  check(pulses[STEP_PIN[0]] == 4000 && pulses[STEP_PIN[1]] == 1500 && pulses[STEP_PIN[2]] == 0, "un pulso por paso en cada eje");
  check(pinState[DIR_PIN[0]] == HIGH && pinState[DIR_PIN[1]] == LOW, "dirección de cada eje");
  double seconds = (clockUs - t0) / 1e6;
  // 4000 steps at up to 4000 steps/s with 8000 steps/s²: ≈ 0.5 s ramping up + 0.5 s cruising + 0.5 s down (~1.5 s).
  check(seconds > 1.2 && seconds < 1.9, "dura lo que manda la rampa", std::to_string(seconds) + " s");
  check(shortestGap[STEP_PIN[0]] >= 245 && shortestGap[STEP_PIN[0]] <= 270, "no pasa de 4000 pasos/s", std::to_string(shortestGap[STEP_PIN[0]]) + " us");
  // The slowest steps (start and end of the ramp) are many times slower than cruising speed.
  check(longestGap[STEP_PIN[0]] >= 10 * shortestGap[STEP_PIN[0]], "arranca y frena despacio", std::to_string(longestGap[STEP_PIN[0]]) + " us");

  check(talk("pos", "\n") == "pos 4000 -1500 0\n", "posición");
  r = talk("go 1 2", "\n");
  check(r.rfind("err ", 0) == 0, "rechaza una orden incompleta", r);
  check(talk("go 1 2 3 4", "\n").rfind("err ", 0) == 0, "rechaza posiciones de más");
  check(talk("bailar", "\n") == "err orden no valida: bailar\n", "orden desconocida");
  check(talk("zero", "\n") == "ok zero\n" && talk("pos", "\n") == "pos 0 0 0\n", "poner a cero");

  // Stop in the middle of a long move.
  Serial.out.clear();
  for (const char *p = "go 100000 0 0\n"; *p; p++) Serial.in.push_back(*p);
  for (int i = 0; i < 40000; i++) { loop(); clockUs += 5; }
  check(talk("go 5 5 5", "\n") == "err moviendo\n", "no acepta otra orden mientras se mueve");
  r = talk("stop", "done");
  long stoppedAt = atol(r.substr(r.find("done ") + 5).c_str());
  check(r.rfind("ok stop\ndone ", 0) == 0 && stoppedAt > 0 && stoppedAt < 100000, "parar a mitad", r);

  // Line too long.
  std::string longLine(150, 'x');
  check(talk(longLine.c_str(), "err").find("err linea demasiado larga") != std::string::npos, "línea demasiado larga");

  printf(failures ? "\nFALLOS: %d\n" : "\nTODO OK\n", failures);
  return failures ? 1 : 0;
}
