// Marshal Board Diagnostic v6 — Bridge.notify -> Python print path.
//
// MCU Monitor.println proved unreliable on this App Lab image (only the
// first 1-19 lines flush; subsequent prints get dropped). v6 routes the
// diagnostic data through Bridge.notify("diag", ...) to the Linux/Python
// side, where python/main.py prints it to its own (separate, more reliable)
// Console pane. LED_BUILTIN blinks once per second as a heartbeat that
// bypasses the Bridge entirely.

#include <Arduino_RouterBridge.h>

uint32_t n = 0;

void setup() {
  Bridge.begin();
  pinMode(LED_BUILTIN, OUTPUT);
  for (int i = 2; i <= 8; i++) pinMode(i, INPUT_PULLUP);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);

  n++;
  int a0 = analogRead(A0);
  int a1 = analogRead(A1);
  int b2 = digitalRead(2), b3 = digitalRead(3), b4 = digitalRead(4);
  int b5 = digitalRead(5), b6 = digitalRead(6), b7 = digitalRead(7), b8 = digitalRead(8);

  // Sketch -> Python: Python's Bridge.provide("diag", on_diag) handler
  // receives these args and prints them to the App Lab Python Console.
  Bridge.notify("diag", (int)n, a0, a1, b2, b3, b4, b5, b6, b7, b8);
}
