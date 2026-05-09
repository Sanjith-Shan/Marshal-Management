"""Marshal Management — UNO Q hardware command board (Linux/MPU side).

Receives button + joystick events from the MCU sketch via Router Bridge,
translates them into the same {type, payload} action shape that the browser
client emits, and forwards them to the Marshal Management Node server over
Socket.IO. The Node server treats this Python process as just another
Socket.IO client alongside the desktop browser.

Configuration: edit SERVER_URL below (or set the SERVER_URL env var) to
point at the laptop running `npm run dev` on the same WiFi network.
"""

import os
import time
import threading

import socketio
from arduino.app_utils import App, Bridge


# ---------- configuration ----------

# Pre-demo: change this to your laptop's LAN IP and port.
# Example: "http://192.168.1.50:3000"
DEFAULT_SERVER_URL = "http://192.168.1.50:3000"
SERVER_URL = os.environ.get("SERVER_URL", DEFAULT_SERVER_URL)


# ---------- mapping: hardware event → Marshal action ----------

# Each entry maps the button-name string emitted by the MCU sketch
# (sketch/sketch.ino) to the {type, payload} the Node server expects.
# Keep this in lockstep with arduino/marshal_board/marshal_board.ino,
# server/services/ArduinoService.js, client/src/interaction/Keybindings.js,
# and the HUD control strip per CLAUDE.md's parity rule.
BUTTON_ACTIONS = {
    "weather":   {"type": "panel", "payload": "weather"},
    "evac":      {"type": "panel", "payload": "evacuation"},
    "ai":        {"type": "panel", "payload": "advisor"},
    "video":     {"type": "panel", "payload": "video"},
    "mode":      {"type": "mode-cycle"},
    "reset":     {"type": "reset"},
    "joy_click": {"type": "joystick:reset"},
}


# ---------- Socket.IO client ----------

sio = socketio.Client(reconnection=True, reconnection_attempts=0,
                      reconnection_delay=2, reconnection_delay_max=10)


@sio.event
def connect():
    print(f"[sio] connected to {SERVER_URL}")


@sio.event
def disconnect():
    print("[sio] disconnected")


@sio.event
def connect_error(data):
    print(f"[sio] connect error: {data}")


def _connect_loop():
    """Background reconnect — retries forever so a power-cycled laptop
    doesn't permanently disable the board."""
    while True:
        if not sio.connected:
            try:
                sio.connect(SERVER_URL, transports=["websocket"])
            except Exception as e:
                print(f"[sio] connect failed: {e}")
        time.sleep(2)


# ---------- bridge handlers (called by the MCU sketch) ----------

def on_button(name):
    """Sketch calls Bridge.notify('button', '<name>') on each press."""
    action = BUTTON_ACTIONS.get(name)
    if action is None:
        print(f"[bridge] unknown button '{name}' — ignored")
        return
    print(f"[bridge] button {name!r} → {action}")
    if sio.connected:
        try:
            sio.emit("action", action)
        except Exception as e:
            print(f"[sio] emit failed: {e}")


def on_joystick(dx, dy):
    """Sketch calls Bridge.notify('joystick', dx, dy) ~30 Hz when stick is
    deflected past its deadzone. The server already broadcasts joystick
    events to clients; payload shape matches the legacy USB path."""
    if not sio.connected:
        return
    try:
        sio.emit("action", {"type": "joystick", "payload": {"dx": float(dx), "dy": float(dy)}})
    except Exception as e:
        print(f"[sio] joystick emit failed: {e}")


# Register the handlers the sketch's Bridge.notify(...) calls will route into.
# If the App Lab Python runtime exposes a different registration symbol on a
# given image (e.g. @Bridge.on or a decorator-only API), swap accordingly —
# Bridge.provide is the form documented in the App Lab forum threads.
Bridge.provide("button", on_button)
Bridge.provide("joystick", on_joystick)

threading.Thread(target=_connect_loop, daemon=True).start()


def loop():
    # All real work happens in the bridge handlers above; the user loop just
    # idles. App.run requires a callable.
    time.sleep(1)


if __name__ == "__main__":
    print(f"[marshal-board] starting; will forward actions to {SERVER_URL}")
    App.run(user_loop=loop)
