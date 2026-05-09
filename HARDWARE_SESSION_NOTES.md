# Hardware Integration — Session Handoff Notes

Captured 2026-05-09. Read this first when picking up the hardware work next session.
The architectural / intent record lives in `BUILD_LOG.md` (sessions 18 and 19); this
doc is the practical lessons-learned + current-state for the next person at the bench.

---

## Status as of session end

- **UNO Q board is fully healthy.** A 5V-on-the-joystick incident damaged the
  joystick module but **not** the board. All analog and digital pins on the
  UNO Q have been tested with direct jumper wires and respond correctly.
- **New joystick + 3V3 rail works.** Reads stable ~512 at rest, sweeps 0–1023
  cleanly per axis (independent X / Y).
- **All 6 push buttons + joystick click work** on D2–D8 after a breadboard
  rail-bridge fix (see below).
- **Diagnostic project (`arduino/diagnostic_q/`) is the proven-good template.**
  It uses the `Bridge.notify` → Python `print()` pattern that we know works.
- **Production code is staged but NOT yet flashed end-to-end.** Files in
  `arduino/marshal_board_q/` are ready to paste into a working App Lab
  project. The user got to "ready to deploy" but ended the session before
  running production. **Pick up here.**

---

## Critical UNO Q gotchas — learned the hard way

These are non-obvious and cost hours to discover. Knowing them up front
will save the next session from re-debugging the same issues.

### 1. `Serial.println()` does NOT work over USB-C
The UNO Q's classic hardware UART (`Serial`) is on D0/D1 pins, not USB-C.
USB-C is bridged to the MPU/Linux side via `Monitor`. Use:
```cpp
#include <Arduino_RouterBridge.h>
Monitor.println("hello");   // works
Serial.println("hello");    // silent
```

### 2. `Monitor.println` only reliably flushes a SINGLE startup call
Even with `Monitor` correctly used, **chained `Monitor.print(...)` calls in
`loop()` get dropped silently after 1–19 iterations** (count varies). One
single-string `Monitor.println("...")` at startup works. Anything inside
`loop()` is unreliable.

**Workaround that works:** route runtime data through `Bridge.notify(name, args...)`
to the Python side, and have Python `print()` it. Python's stdout goes to
App Lab's Python Console pane — a separate, reliable transport. This is the
canonical App Lab pattern anyway.

### 3. `Arduino_RouterBridge` library is not in the Library Manager index
Declaring it in `sketch.yaml`'s `libraries:` list fails to resolve. So does
omitting it (header isn't bundled with the platform on this image).

**Workaround that works:** **Fork an App Lab example that already uses
`Arduino_RouterBridge`** and replace its `sketch.ino` and `python/main.py`
with your code. The example's `sketch.yaml` + bundled deps come along for
free. Both `arduino/diagnostic_q/` and `arduino/marshal_board_q/` are
designed to be pasted into a forked example.

### 4. UNO Q analog pins are NOT 5V tolerant
3.3V logic. Wire joystick `Vcc` to the **3V3 rail**, not 5V. Hooking a
joystick to 5V and deflecting it will damage the joystick module (the
analog pins on the board itself survive thanks to internal protection
diodes, but joystick replacement is needed). Confirmed by direct jumper
testing post-incident.

### 5. Breadboard power rails are often SPLIT in the middle
Many 830/400-tie breadboards have `+` and `-` rails that look continuous
but are actually **two electrically isolated halves** with a hidden gap.
If only one half is connected to UNO Q's GND/3V3, the other half is
floating. Symptoms in this project:
- 3 of 6 buttons not registering (their GND legs were on the unconnected
  half of the `-` rail)
- Joystick fluctuating wildly between 0 and 1023 with no input (its `Vcc`
  was on the unconnected half of the `+` rail)

**Fix:** add two short jumper wires that bridge the gap on each rail. Or
plug a second wire from UNO Q's GND/3V3 into the floating half.

### 6. App Lab editor auto-indents on paste
Multi-line paste adds 4 spaces of indent to every line after the first.
Python's strict about indentation → `IndentationError: unexpected indent`.

**Workarounds, in order of reliability:**
1. **Cmd+A → Delete → type the first line manually → press Enter → paste the rest.**
   The auto-indent only fires when the cursor inherits indent context.
2. **Paste-as-plain-text:** `Cmd+Shift+V` (mac) / `Ctrl+Shift+V` (win/linux).
3. **Select all the unwanted-indent lines and Shift+Tab** to outdent.
4. **SSH into UNO Q** and use a heredoc:
   ```
   ssh arduino@<uno-q-ip>
   cat > /path/to/python/main.py << 'PYEOF'
   <paste content here, indentation preserved exactly>
   PYEOF
   ```

### 7. `Bridge.begin()` is required for `Bridge.notify` to work
But the order matters and it can hang on some images. Pattern that works:
```cpp
void setup() {
  Bridge.begin();
  Monitor.begin();
  // ... pinMode setup ...
  delay(800);                    // give Bridge time to handshake
  Monitor.println("ready");      // single startup log
}
```

### 8. Joystick click counts as a digital input
Wired to D2 with `INPUT_PULLUP`. The `b=` digital-readout string in the
diagnostic has **7 digits** (D2–D8), not 6 — D2 is the joystick's SW pin.
Left-to-right ordering: D2, D3, D4, D5, D6, D7, D8.

---

## Files to know

| Path | Purpose |
|---|---|
| `arduino/marshal_board_q/sketch/sketch.ino` | Production MCU sketch — Bridge.notify only, no Monitor in loop |
| `arduino/marshal_board_q/python/main.py` | Production Python — Bridge.provide handlers + Socket.IO client to Node server |
| `arduino/marshal_board_q/README.md` | Wiring + setup guide |
| `arduino/diagnostic_q/sketch/sketch.ino` | Diagnostic — proves analog/digital pins healthy |
| `arduino/diagnostic_q/python/main.py` | Diagnostic Python — prints raw pin readings |
| `arduino/marshal_board/marshal_board.ino` | Legacy classic-UNO USB-serial sketch — kept as reference per CLAUDE.md, NOT for UNO Q |

---

## Action mapping (parity rule reference)

The hardware → server action shape, kept in lockstep with keyboard +
HUD per CLAUDE.md's three-way parity convention:

| Hardware (D-pin) | Sketch event | Python emits | Server handler |
|---|---|---|---|
| D2 (joy click) | `Bridge.notify("button","joy_click")` | `{type:'joystick:reset'}` | broadcast `joystick:reset` |
| D3 Weather | `Bridge.notify("button","weather")` | `{type:'panel',payload:'weather'}` | `togglePanel('weather')` |
| D4 Evac | `Bridge.notify("button","evac")` | `{type:'panel',payload:'evacuation'}` | `togglePanel('evacuation')` |
| D5 AI | `Bridge.notify("button","ai")` | `{type:'panel',payload:'advisor'}` | `togglePanel('advisor')` |
| D6 Video | `Bridge.notify("button","video")` | `{type:'panel',payload:'video'}` | `togglePanel('video')` |
| D7 Mode | `Bridge.notify("button","mode")` | `{type:'mode-cycle'}` | `cycleMode()` |
| D8 Reset | `Bridge.notify("button","reset")` | `{type:'reset'}` | `resetScenario(...)` |
| A0/A1 joystick | `Bridge.notify("joystick", dx, dy)` | `{type:'joystick',payload:{dx,dy}}` | broadcast `joystick` |

`mode-cycle` is a new server action added this session — see
`server/services/StateManager.js:cycleMode()` and `server/index.js`.

---

## Pending — pick up here next session

### Hardware
1. **Edit `SERVER_URL` in production `python/main.py`** to laptop's LAN IP.
   Get the IP with `ipconfig getifaddr en0` (mac).
2. **Paste production `sketch.ino` and `python/main.py`** into the same
   App Lab example fork that worked for the diagnostic. Use the indent
   workaround from gotcha #6.
3. **Run `npm run dev` on the laptop**, then click Run in App Lab.
4. **Verify each button toggles its panel / cycles mode / resets scenario**
   in the browser at `http://localhost:5173`. Verify joystick rotates the
   map. Joystick click should reset the camera view.

### VR side (your friend's lane)
- HTTPS infrastructure is already in place via `f371b21`
  (`@vitejs/plugin-basic-ssl` + LAN IP banner). See `QUEST_SETUP.md`.
- Per `BUILD_LOG.md` session 13 Tier B, remaining VR items are: B2 validate
  `immersive-ar` on real Quest 3, B3 3D AR panels (DOM panels likely
  invisible in passthrough), B4 RATK plane detection, B5 hand tracking.
- **Three files are shared between the hardware and VR lanes** —
  if either side touches them, surface the change to the other:
  `client/src/main.js`, `client/index.html`, `package.json`. The user
  asked Claude not to touch any of these for the rest of the hardware
  work; respect that boundary unless the user lifts it.

---

## Quick start for next session

1. `git pull origin main` to sync.
2. `npm install` to pick up any deps your friend may have added.
3. Read this file. Skim `BUILD_LOG.md` sessions 18 + 19 only if needed.
4. Plug in UNO Q. Open the App Lab project that worked last time (it's
   the one forked from the bundled example, NOT the standalone
   `arduino/marshal_board_q/` folder which App Lab can't open without
   the library being installed).
5. Pick up at "Pending → Hardware" step 1 above.

---

## Tests that must still pass

```
node server/_selftest.js     # 25/25 PASSED
MM_FORCE_MOCK=1 node server/_e2e.js   # 14/14 PASSED
npm run build                # clean build
```

Run all three after any server-side change.

---

## Don't repeat these mistakes

- Don't try to use `Serial.println` on UNO Q over USB-C.
- Don't rely on `Monitor.println` for runtime data inside `loop()`.
- Don't declare `Arduino_RouterBridge` in `sketch.yaml`'s `libraries` —
  fork from a working App Lab example instead.
- Don't wire the joystick to 5V.
- Don't trust breadboard rails as continuous — bridge them.
- Don't paste multi-line code into the App Lab editor without the indent
  workaround.
- Don't push to `main` without pulling first; your friend's VR work is
  active in parallel.
