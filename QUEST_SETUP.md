# Quest 3 setup — testing over LAN

Quick path to load Marshal Management on a Meta Quest 3 from your dev
machine over the same Wi-Fi network. The Quest browser hits your Mac's
LAN IP directly; no public hosting needed.

## Prereqs

- Meta Quest 3 (or Quest Pro — anything with passthrough + WebXR `immersive-ar`)
- Quest and dev machine on the **same Wi-Fi network**
- Mac firewall allows incoming on port 5173 (System Settings → Network → Firewall, or just allow when prompted)

## One-time setup (already applied to this repo)

`@vitejs/plugin-basic-ssl` is in `devDependencies`. It auto-generates a
self-signed cert at startup so the Quest browser can hit `https://...`.

If you cloned fresh, run:

```bash
npm install
```

## Running

For day-to-day desktop development, use plain `npm run dev` — that runs
the dev server over plain HTTP so the Mac browser doesn't have to click
through any cert warning.

When you want to test on a Quest, opt in to HTTPS:

```bash
npm run dev:quest
```

This sets `HTTPS=1`, the Vite dev server generates a self-signed cert
on startup, and the server prints both your `localhost` URL and your
**LAN IPs** in the banner — copy one into the Quest browser. Output
looks like:

```
  ▲  Marshal Management server
     http://localhost:3000
     Vite dev:  http://localhost:5173

     For Quest 3 (same Wi-Fi):
       https://192.168.1.42:5173    (en0)
     Tap "Advanced → Proceed" on the cert warning, then "Enter AR".
```

If multiple IPs are listed (Wi-Fi + Ethernet, or VM bridges), use the
one matching your Wi-Fi network. On a Mac, that's usually `en0`.

## On the Quest 3

1. Put on the headset, open the **Browser** app.
2. Type the LAN URL (e.g., `https://192.168.1.42:5173`).
3. **First connection only:** the browser shows a "Your connection is
   not private" warning. Tap **Advanced** → **Proceed**. (This is the
   self-signed cert — same warning a desktop browser shows the first
   time.) The Quest remembers the exception.
4. The Marshal Management HUD should load — terrain, fire, panels.
5. Tap **Enter AR** in the top-right HUD.
6. Quest will ask permission for camera passthrough — allow.
7. The page enters immersive-ar; the terrain renders ~1 m in front of
   you at floor height.

Use hand pinches or the Quest controllers to interact (note: hand
tracking is not yet integrated — the AR scene currently just renders;
input is keyboard-driven from the connected dev machine).

## What works in AR right now

- Terrain mesh, fire overlay, road network, zone polygons, route flow
  particles, population dots, contraflow chevrons, compass + wind arrow,
  perimeter overlay (toggleable from desktop with `F`)
- The simulation continues running — server tick + CA spread + AI
  advisor + voice intents all work; you're seeing the same state your
  desktop browser sees.

## Known caveats

- **AR untested on real hardware until now** — this is the first time
  the path runs end-to-end on a Quest. Expect surprises. If the page
  doesn't render or `Enter AR` errors, check the browser console
  (`chrome://inspect` from a USB-connected Mac, or use the in-headset
  developer console).
- **No plane detection / RATK anchoring.** Terrain is at fixed offset
  `(0, 0.05, -1.2)` from the user. You can walk around it but not
  anchor it to a real table.
- **DOM panels may not render in immersive-ar passthrough** — they're
  rendered on top of the canvas, which the AR session re-mounts. If
  panels are invisible in AR, exit AR and they'll reappear.
- **Hand tracking 0% implemented.** You can see the simulation but
  can't pinch-block roads in AR yet — use the desktop or another
  browser to drive the input.
- **Self-signed cert warning re-appears** if you switch IPs (e.g.,
  Wi-Fi reconnect with DHCP lease change). Just tap Proceed again.

## Troubleshooting

**Quest can't reach the URL** — on the Mac, run:

```bash
ifconfig | grep 'inet '
```

…and pick the IP under `en0` (Wi-Fi). Make sure the Mac and Quest are
on the same network (some guest networks isolate clients — try a home
network or a personal hotspot).

**"This site can't be reached"** — Mac firewall is blocking. System
Settings → Network → Firewall → allow `node` if prompted, or temporarily
disable for testing.

**Page loads but `Enter AR` does nothing** — Check the Quest browser
console. Likely the `requestSession('immersive-ar')` rejected because
the page isn't on a secure context. Confirm the URL starts with
`https://`, not `http://`.

**Cert warning won't go away** — Quest Browser persists the exception
per-host. If you change the Mac's IP, you'll see the warning once on
the new IP, then it's remembered.

**Want a public URL instead of LAN?** Cloudflared tunnel is easy:

```bash
cloudflared tunnel --url https://localhost:5173
```

That gives a public `https://*.trycloudflare.com` URL, valid for one
session, no cert warning. Useful if you can't get on the same Wi-Fi.
