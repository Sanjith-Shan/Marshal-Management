// Marshal Management — Hardware Command Board firmware
// Target: Arduino UNO
// Sends a CSV line at ~30 Hz over USB serial.
//
// Wiring:
//   A0  joystick X
//   A1  joystick Y
//   D2  joystick click (active LOW, INPUT_PULLUP)
//   D3  push-to-talk           (active LOW, INPUT_PULLUP)
//   D4  panel: weather         (active LOW, INPUT_PULLUP)
//   D5  panel: evacuation
//   D6  panel: advisor
//   D7  panel: video
//   D8  EVACUATE (red button)
//   D9  mode switch A
//   D10 mode switch B
//   D11 reset (recessed)
//
// Buttons connect pin to GND. INPUT_PULLUP idle = HIGH = 1, pressed = LOW = 0.
// We invert in firmware so "1" = active to keep the host parser simple.

const uint8_t PIN_JCLICK = 2;
const uint8_t PIN_PTT    = 3;
const uint8_t PIN_PWX    = 4;
const uint8_t PIN_PEVAC  = 5;
const uint8_t PIN_PAI    = 6;
const uint8_t PIN_PVID   = 7;
const uint8_t PIN_EVAC   = 8;
const uint8_t PIN_MODEA  = 9;
const uint8_t PIN_MODEB  = 10;
const uint8_t PIN_RESET  = 11;

uint8_t buttons[] = {
  PIN_JCLICK, PIN_PTT, PIN_PWX, PIN_PEVAC,
  PIN_PAI, PIN_PVID, PIN_EVAC, PIN_MODEA,
  PIN_MODEB, PIN_RESET
};

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < sizeof(buttons); i++) {
    pinMode(buttons[i], INPUT_PULLUP);
  }
}

inline int activeLow(uint8_t pin) {
  return digitalRead(pin) == LOW ? 1 : 0;
}

void loop() {
  int jx = analogRead(A0);
  int jy = analogRead(A1);

  int jClick   = activeLow(PIN_JCLICK);
  int ptt      = activeLow(PIN_PTT);
  int wx       = activeLow(PIN_PWX);
  int evacP    = activeLow(PIN_PEVAC);
  int aiP      = activeLow(PIN_PAI);
  int vidP     = activeLow(PIN_PVID);
  int evacuate = activeLow(PIN_EVAC);
  int modeA    = activeLow(PIN_MODEA);
  int modeB    = activeLow(PIN_MODEB);
  int rst      = activeLow(PIN_RESET);

  // Order must match the parser in ArduinoService.js
  Serial.print(jx);       Serial.print(',');
  Serial.print(jy);       Serial.print(',');
  Serial.print(ptt);      Serial.print(',');
  Serial.print(wx);       Serial.print(',');
  Serial.print(evacP);    Serial.print(',');
  Serial.print(aiP);      Serial.print(',');
  Serial.print(vidP);     Serial.print(',');
  Serial.print(evacuate); Serial.print(',');
  Serial.print(modeA);    Serial.print(',');
  Serial.print(modeB);    Serial.print(',');
  Serial.print(rst);      Serial.print(',');
  Serial.println(jClick);

  delay(33);
}
