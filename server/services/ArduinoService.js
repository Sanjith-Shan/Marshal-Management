// ArduinoService — connects to the optional hardware command board over USB
// serial. If `serialport` cannot find a device, the service stays silent and
// the keyboard fallback is used instead.

import { EventEmitter } from 'events';

export class ArduinoService extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.port = null;
    this.parser = null;
    this.prev = {};
  }

  async start() {
    if (process.env.DISABLE_ARDUINO === '1') {
      console.log('[arduino] disabled by DISABLE_ARDUINO=1');
      return;
    }
    let SerialPort, ReadlineParser;
    try {
      ({ SerialPort, ReadlineParser } = await import('serialport'));
    } catch (err) {
      console.log('[arduino] serialport not available — keyboard fallback only');
      return;
    }
    try {
      const ports = await SerialPort.list();
      const candidate = ports.find(p =>
        /(arduino|usbmodem|ttyACM|wchusbserial|usbserial)/i.test(p.path + ' ' + (p.manufacturer || ''))
      );
      if (!candidate) {
        console.log('[arduino] no candidate USB serial port found — keyboard fallback only');
        return;
      }
      this.port = new SerialPort({ path: candidate.path, baudRate: 115200 });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
      this.parser.on('data', (line) => this._onLine(line));
      this.port.on('open', () => {
        this.connected = true;
        console.log(`[arduino] connected on ${candidate.path}`);
      });
      this.port.on('close', () => {
        this.connected = false;
        console.log('[arduino] disconnected');
      });
      this.port.on('error', (err) => {
        console.warn('[arduino] error:', err.message);
        this.connected = false;
      });
    } catch (err) {
      console.warn('[arduino] start failed:', err.message);
    }
  }

  _onLine(line) {
    const parts = line.trim().split(',').map(Number);
    if (parts.length < 12 || parts.some(Number.isNaN)) return;
    // Field 3 in legacy classic-UNO firmware was push-to-talk; PTT was
    // removed from the system (2026-05-09) so this slot is intentionally
    // parsed and ignored. Fields 13/14 (tBack, tFwd) added with TODO group H1;
    // older firmware sending 12 fields still works — the destructuring leaves
    // them undefined.
    const [jx, jy, /* legacy ptt, unused */ , wx, evac, ai, vid, evacuate, mA, mB, reset, jClick, tBack, tFwd] = parts;

    // Joystick deadzone → analog pan/rotate
    if (Math.abs(jx - 512) > 60 || Math.abs(jy - 512) > 60) {
      this.emit('event', {
        type: 'joystick',
        payload: { dx: (jx - 512) / 512, dy: (jy - 512) / 512 }
      });
    }

    // Edge-triggered buttons
    this._edge('wx', wx, () => this.emit('event', { type: 'panel', payload: 'weather' }));
    this._edge('evac', evac, () => this.emit('event', { type: 'panel', payload: 'evacuation' }));
    this._edge('ai', ai, () => this.emit('event', { type: 'panel', payload: 'advisor' }));
    this._edge('vid', vid, () => this.emit('event', { type: 'panel', payload: 'video' }));
    this._edge('evacuate', evacuate, () => this.emit('event', { type: 'evacuate' }));
    this._edge('reset', reset, () => this.emit('event', { type: 'reset' }));
    this._edge('jClick', jClick, () => this.emit('event', { type: 'joystick:reset' }));
    if (tFwd !== undefined) {
      this._edge('tFwd', tFwd, () =>
        this.emit('event', { type: 'time-jump', payload: { deltaMin: 30 } })
      );
    }
    if (tBack !== undefined) {
      this._edge('tBack', tBack, () =>
        this.emit('event', { type: 'time-jump', payload: { deltaMin: -30 } })
      );
    }

    // Mode switch (2 pins encode 3 positions)
    const modeBits = `${mA}${mB}`;
    const newMode = modeBits === '10' ? 'COMMAND'
                  : modeBits === '01' ? 'EVACUATE'
                  : 'MONITOR';
    if (this.prev.mode !== newMode) {
      this.prev.mode = newMode;
      this.emit('event', { type: 'mode', payload: newMode });
    }
  }

  _edge(key, val, fn, opts = {}) {
    const prev = this.prev[key] ?? 0;
    if (prev !== val) {
      if (opts.both) fn();
      else if (val === 1 && prev === 0) fn();
      this.prev[key] = val;
    }
  }
}
