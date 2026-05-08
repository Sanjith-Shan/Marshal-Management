// Small browser-side EventEmitter (no Node imports).
export class EventEmitter {
  constructor() { this._handlers = {}; }
  on(name, fn) {
    (this._handlers[name] ||= []).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const a = this._handlers[name];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  emit(name, ...args) {
    (this._handlers[name] || []).forEach(fn => {
      try { fn(...args); } catch (err) { console.warn(err); }
    });
  }
}
