# Marshal Management — UNO Q Hardware Command Board

Arduino UNO Q + Arduino App Lab project for the Marshal Management AR
fire-marshal command center. The board reads a joystick and 6 push buttons
and emits the same `{ type, payload }` actions the browser client uses,
delivered to the Node server over a WiFi-attached Socket.IO connection.

## Wiring

Joystick (5-pin module) — **use the 3V3 rail, not 5V** (UNO Q analog inputs
are not 5 V tolerant):

| Joystick pin | UNO Q |
|---|---|
| GND | GND |
| Vcc | 3V3 |
| VRx | A0 |
| VRy | A1 |
| SW  | D2 |

Push buttons (2-pin momentary, one leg to the labeled pin, the other leg to
GND, internal `INPUT_PULLUP`):

| Pin | Function | Action emitted to server |
|---|---|---|
| D3 | Weather Panel | `{ type: 'panel', payload: 'weather' }` |
| D4 | Evac Panel    | `{ type: 'panel', payload: 'evacuation' }` |
| D5 | AI Panel      | `{ type: 'panel', payload: 'advisor' }` |
| D6 | Video Panel   | `{ type: 'panel', payload: 'video' }` |
| D7 | Mode Cycle    | `{ type: 'mode-cycle' }` (MONITOR → COMMAND → EVACUATE → MONITOR) |
| D8 | Reset         | `{ type: 'reset' }` |
| D2 | Joystick click | `{ type: 'joystick:reset' }` |
| A0/A1 | Joystick   | `{ type: 'joystick', payload: { dx, dy } }` (~30 Hz) |

## Architecture

The UNO Q has two CPUs. The MCU (STM32U585) reads the GPIO and emits Bridge
notifications to the MPU (Linux). A Python program on the Linux side opens
a Socket.IO connection to the laptop running `npm run dev` and forwards
each event as an action — the same channel the desktop browser uses.

```
buttons → MCU sketch ──Bridge.notify──▶ python/main.py ──Socket.IO──▶ Node server
                                                                            │
                                                                            ▼
                                                                        broadcasts
                                                                        to clients
```

## Project layout

```
marshal_board_q/
├── README.md                  this file
├── app.yaml                   App Lab manifest
├── python/
│   ├── main.py                Bridge handlers + Socket.IO client
│   └── requirements.txt       python-socketio, websocket-client
└── sketch/
    ├── sketch.ino             MCU firmware (INPUT_PULLUP + Bridge.notify)
    └── sketch.yaml            FQBN + library deps
```

## Setup (one-time)

1. Install **Arduino App Lab** for your OS — https://docs.arduino.cc/software/app-lab/
2. Power the UNO Q over USB-C and complete the first-run flow (set device
   password, join your WiFi).
3. Edit `python/main.py`: change `DEFAULT_SERVER_URL` to your laptop's LAN
   IP and port (default `http://192.168.1.50:3000`). Find it with
   `ipconfig getifaddr en0` (mac) or `hostname -I` (linux).
4. In App Lab: **File → Open App** → choose this folder
   (`arduino/marshal_board_q/`). Click **Run**. First start is slow (App
   Lab builds the Python venv from `requirements.txt` in the on-device
   container); subsequent starts are cached.

## Running the demo

1. Start the Marshal Management server on your laptop:
   ```
   npm run dev
   ```
2. From a Quest 3 (or desktop browser) point at `http://<laptop-IP>:5173`
   and confirm the scene renders.
3. With the UNO Q on the same WiFi, click **Run** in App Lab.
4. Press buttons and move the joystick — actions should fire instantly.
   App Lab's Console shows both `[btn] <name>` lines from the MCU and
   `[bridge]` / `[sio]` lines from Python.

## Tweaking the firmware

- **Loop cadence:** `LOOP_DELAY_MS` in `sketch.ino` (10 ms = 100 Hz).
- **Joystick deadzone:** `JOY_DEADZONE` (default 60 LSBs of a 1023-step
  ADC). Increase if center drift is making the camera nudge.
- **Joystick rate:** `JOY_EMIT_INTERVAL_MS` (default 33 ms ≈ 30 Hz). The
  Node server doesn't store joystick state, so faster doesn't help much.
- **Debounce:** `DEBOUNCE_MS` (default 20 ms) — raise if a noisy switch
  triggers double-fires, lower for snappier feel.

## Troubleshooting

- **`Serial.println()` doesn't show in the App Lab console.** Use
  `Monitor.println()` from `<Arduino_RouterBridge.h>` instead. UNO Q's USB-C
  is bridged to the MPU; classic `Serial` goes to the D0/D1 hardware UART.
- **Bridge.provide AttributeError on Python side.** App Lab images vary;
  open an SSH session and run `python -c "from arduino.app_utils import Bridge; print(dir(Bridge))"` to enumerate the actual symbol.
  Common alternatives are `Bridge.on(...)` and a decorator form.
- **`[sio] connect failed`** repeating. Confirm the laptop and UNO Q are on
  the same network and `SERVER_URL` matches the laptop's IP. Disable any
  firewall rule blocking port 3000.
- **First run is slow.** App Lab is building the Python venv from
  `requirements.txt`. Subsequent starts are quick.

## Why this is a separate project from `arduino/marshal_board/`

Per `CLAUDE.md`: the classic UNO + USB-serial sketch in `arduino/marshal_board/`
is the documented reference path and stays untouched. The UNO Q is the
production target — different MCU (STM32U585 on Zephyr RTOS, 3.3 V GPIO),
different toolchain (App Lab, not Arduino IDE), and different transport
(WiFi via the MPU, not USB serial via the host). The two projects share the
button-name → action shape so the rest of the codebase doesn't change.
