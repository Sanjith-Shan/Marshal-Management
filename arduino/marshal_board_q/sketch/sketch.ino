// Marshal Management — UNO Q hardware command board (MCU side).
//
// Reads joystick + 6 buttons; forwards each event over the Router Bridge
// to python/main.py on the Linux side, which then emits a Socket.IO action
// to the Marshal Management Node server.
//
// IMPORTANT — UNO Q gotchas (learned the hard way 2026-05-09):
//   - Use Monitor.println, NOT Serial.println, for App Lab console output.
//   - Monitor only reliably flushes a SINGLE complete-line call, and even
//     then only at startup — repeated Monitor.print(...) chains in loop()
//     get dropped after a handful of lines. Production code uses
//     Bridge.notify exclusively for runtime data; Python prints to its
//     own Console which is reliable.
//   - GPIO is 3.3 V. Wire the joystick Vcc to 3V3 (NOT 5V).
//   - Buttons connect pin → GND; we use INPUT_PULLUP so pressed = LOW = 0.
//
// Wiring (matches arduino/marshal_board_q/README.md):
//   A0       joystick X
//   A1       joystick Y
//   D2       joystick click
//   D3       Weather panel toggle
//   D4       Evac panel toggle
//   D5       AI panel toggle
//   D6       Video panel toggle
//   D7       Mode cycle (MONITOR → COMMAND → EVACUATE)
//   D8       Reset

#include <Arduino_RouterBridge.h>

// Loop cadence — fast enough for responsive joystick, slow enough that the
// Bridge isn't flooded.
static const uint16_t LOOP_DELAY_MS = 10;

// Joystick deflection deadzone: anything within ±DEADZONE of center (~512) is
// treated as "centered" and suppresses joystick events.
static const int16_t JOY_CENTER = 512;
static const int16_t JOY_DEADZONE = 60;

// Joystick emission rate cap. The map rotation only needs ~30 Hz updates.
static const uint16_t JOY_EMIT_INTERVAL_MS = 33;

// Pin assignments
static const uint8_t PIN_JOY_X = A0;
static const uint8_t PIN_JOY_Y = A1;
static const uint8_t PIN_JOY_CLICK = 2;
static const uint8_t PIN_WEATHER = 3;
static const uint8_t PIN_EVAC = 4;
static const uint8_t PIN_AI = 5;
static const uint8_t PIN_VIDEO = 6;
static const uint8_t PIN_MODE = 7;
static const uint8_t PIN_RESET = 8;

struct Button {
  uint8_t pin;
  const char* name;     // event name forwarded to Python
  bool lastStable;      // last debounced reading (HIGH = released, LOW = pressed)
  bool lastSample;      // last raw reading
  uint32_t lastChangeMs;
};

static Button buttons[] = {
  { PIN_JOY_CLICK, "joy_click", HIGH, HIGH, 0 },
  { PIN_WEATHER,   "weather",   HIGH, HIGH, 0 },
  { PIN_EVAC,      "evac",      HIGH, HIGH, 0 },
  { PIN_AI,        "ai",        HIGH, HIGH, 0 },
  { PIN_VIDEO,     "video",     HIGH, HIGH, 0 },
  { PIN_MODE,      "mode",      HIGH, HIGH, 0 },
  { PIN_RESET,     "reset",     HIGH, HIGH, 0 },
};
static const uint8_t BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);

static const uint16_t DEBOUNCE_MS = 20;
static uint32_t lastJoyEmitMs = 0;

void setup() {
  Bridge.begin();
  Monitor.begin();
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
  }
  delay(800);
  // Single startup print — reliable. Runtime activity is logged from Python.
  Monitor.println("[marshal-board] ready");
}

void loop() {
  uint32_t nowMs = millis();

  // Buttons — debounced falling-edge detection. Bridge.notify is fire-and-forget.
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    Button& b = buttons[i];
    bool sample = digitalRead(b.pin);
    if (sample != b.lastSample) {
      b.lastSample = sample;
      b.lastChangeMs = nowMs;
    }
    if ((nowMs - b.lastChangeMs) >= DEBOUNCE_MS && sample != b.lastStable) {
      b.lastStable = sample;
      if (sample == LOW) {
        Bridge.notify("button", b.name);
      }
    }
  }

  // Joystick — sampled every loop, only emitted past deadzone, throttled to ~30 Hz.
  if ((nowMs - lastJoyEmitMs) >= JOY_EMIT_INTERVAL_MS) {
    int16_t rawX = analogRead(PIN_JOY_X);
    int16_t rawY = analogRead(PIN_JOY_Y);
    int16_t dx = rawX - JOY_CENTER;
    int16_t dy = rawY - JOY_CENTER;
    if (abs(dx) > JOY_DEADZONE || abs(dy) > JOY_DEADZONE) {
      float fx = (float)dx / 512.0f;
      float fy = (float)dy / 512.0f;
      Bridge.notify("joystick", fx, fy);
      lastJoyEmitMs = nowMs;
    }
  }

  delay(LOOP_DELAY_MS);
}
