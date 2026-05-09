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
import socket as _socket
import subprocess
import time
import threading
from urllib.request import urlopen
from urllib.error import URLError

import socketio
from arduino.app_utils import App, Bridge


# ---------- configuration ----------

# App Lab runs this Python in a Docker container whose bridge subnet
# (172.20.0.0/16) overlaps with the iPhone hotspot subnet (172.20.10.0/28),
# so the container can't reach the Mac directly — traffic to 172.20.10.8 is
# captured by the bridge route and dropped. Workaround: a `socat` forwarder
# runs on the UNO Q host listening on its bridge gateway 172.20.0.1:3000 and
# proxies to the Mac's 172.20.10.8:3000. The container connects to the
# gateway (always reachable) and the host hops it onto WiFi.
# Start the forwarder with: adb shell 'nohup socat TCP4-LISTEN:3000,fork,reuseaddr TCP4:172.20.10.8:3000 </dev/null >/tmp/socat.log 2>&1 &'
DEFAULT_SERVER_URL = "http://172.20.0.1:3000"
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


def _dump_net_state():
    """Print board-side network state so we can see if the board is on the
    expected WiFi at the expected IP."""
    for cmd in (["hostname", "-I"], ["ip", "-4", "-br", "addr"], ["ip", "route", "show", "default"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=2).stdout.strip()
            print(f"[net] $ {' '.join(cmd)}: {out}")
        except Exception as e:
            print(f"[net] $ {' '.join(cmd)} failed: {e}")
    try:
        ssid = subprocess.run(["iwgetid", "-r"], capture_output=True, text=True, timeout=2).stdout.strip()
        print(f"[net] SSID: {ssid or '(none)'}")
    except Exception:
        pass


def _probe_server():
    """Diagnose where the connection fails: TCP layer or HTTP/Socket.IO layer."""
    _dump_net_state()
    from urllib.parse import urlparse
    u = urlparse(SERVER_URL)
    host, port = u.hostname or "127.0.0.1", u.port or 3000
    try:
        with _socket.create_connection((host, port), timeout=3):
            print(f"[probe] TCP {host}:{port} OK")
    except OSError as e:
        print(f"[probe] TCP {host}:{port} FAILED: {e}")
        return False
    try:
        with urlopen(f"{SERVER_URL}/socket.io/?EIO=4&transport=polling", timeout=3) as r:
            body = r.read(120).decode(errors="replace")
            print(f"[probe] HTTP socket.io handshake OK: {body[:60]}…")
    except URLError as e:
        print(f"[probe] HTTP socket.io FAILED: {e}")
        return False
    return True


def _connect_loop():
    """Background reconnect — retries forever so a power-cycled laptop
    doesn't permanently disable the board."""
    probed_ok = False
    while True:
        if not sio.connected:
            if not probed_ok:
                probed_ok = _probe_server()
            try:
                # Default transports = polling+websocket. Lets Socket.IO negotiate
                # the upgrade rather than forcing websocket-only (which can fail
                # silently if the adb tunnel mishandles the WS upgrade frame).
                sio.connect(SERVER_URL)
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
