// WebSocket connection to the game server.
export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.open = false; }
  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => { this.open = true; resolve(); };
      ws.onerror = (e) => reject(e);
      ws.onclose = (e) => { this.open = false; this.handlers.close?.(e); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        const h = this.handlers[m.t];
        if (h) { try { h(m); } catch (e) { console.error('handler', m.t, e); } }
      };
    });
  }
  on(t, fn) { this.handlers[t] = fn; }
  send(m) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}
