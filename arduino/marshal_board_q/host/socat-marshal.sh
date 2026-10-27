#!/bin/sh
# Marshal Management — host-side TCP forwarder.
# Bridges App Lab Docker container traffic on the bridge gateway 172.20.0.1:3000
# out to the Mac running `npm run dev` on the iPhone hotspot. The iPhone hands
# out a different 172.20.10.x lease to the Mac on each reconnect, so this
# script auto-discovers whichever host on the /28 currently answers on :PORT
# with a Socket.IO handshake. Override with MAC_IP=… for a fixed target.
PORT="${PORT:-3000}"
MAC_IP="${MAC_IP:-}"

# Wait up to 60s for wlan0 to have a hotspot IP.
i=0
while [ $i -lt 60 ]; do
  hostname -I 2>/dev/null | grep -q '172\.20\.10\.' && break
  sleep 1
  i=$((i + 1))
done

# Auto-discover the Mac if MAC_IP wasn't supplied: probe the /28 for a host
# that returns a Socket.IO handshake (starts with "0{"). Skip our own IP and
# the iPhone gateway (.1, won't run our server).
if [ -z "$MAC_IP" ]; then
  MY_IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep '^172\.20\.10\.' | head -1)
  for n in 2 3 4 5 6 7 8 9 10 11 12 13 14; do
    cand="172.20.10.$n"
    [ "$cand" = "$MY_IP" ] && continue
    body=$(curl -sS --max-time 1 "http://${cand}:${PORT}/socket.io/?EIO=4&transport=polling" 2>/dev/null)
    case "$body" in
      0\{*) MAC_IP="$cand"; break;;
    esac
  done
fi

if [ -z "$MAC_IP" ]; then
  echo "marshal-socat: no Marshal server found on 172.20.10.0/28 :${PORT}"
  exit 1
fi

echo "marshal-socat: forwarding 172.20.0.1:${PORT} -> ${MAC_IP}:${PORT}"

# Kill any prior listener on this port (match by absolute path so we don't
# pkill our own login shell whose argv contains the same substring).
PRIOR=$(pgrep -f "/usr/bin/socat TCP4-LISTEN:${PORT}")
if [ -n "$PRIOR" ]; then
  kill -9 $PRIOR 2>/dev/null
  sleep 1
fi

exec /usr/bin/socat TCP4-LISTEN:${PORT},fork,reuseaddr TCP4:${MAC_IP}:${PORT}
