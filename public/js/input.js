// Keyboard / mouse state with pointer lock, and rebindable keys: the game asks for each action's *default* key code
// ('KeyE' = interact); pressing whatever physical key the player bound to an action reports that default code.
export const ACTIONS = [
  ['forward', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Move left', 'KeyA'], ['right', 'Move right', 'KeyD'],
  ['jump', 'Jump / swim up', 'Space'], ['sprint', 'Sprint', 'ShiftLeft'], ['crouch', 'Crouch / slide / dive', 'ControlLeft'], ['crouch2', 'Crouch (2nd key)', 'KeyC'],
  ['interact', 'Interact / open / enter', 'KeyE'], ['reload', 'Reload / rotate / recharge', 'KeyR'], ['drink', 'Drink', 'KeyF'], ['toggle', 'Fire out / machine on-off', 'KeyG'],
  ['patch', 'Patch vehicle', 'KeyH'], ['demolish', 'Demolish', 'KeyX'], ['modules', 'Sub module bay', 'KeyU'], ['camera', 'Vehicle camera', 'KeyV'], ['fly', 'Creative flight', 'KeyZ'],
  ['inventory', 'Inventory', 'Tab'], ['inventory2', 'Inventory (2nd key)', 'KeyQ'], ['inventory3', 'Inventory (3rd key)', 'KeyI'], ['map', 'Map', 'KeyM'], ['clan', 'Clan menu', 'KeyL'],
  ['buildclose', 'Close build menu', 'KeyB'], ['chat', 'Chat', 'KeyT'],
];
const DEFAULT_OF = Object.fromEntries(ACTIONS.map(([a, , d]) => [a, d]));
const IS_DEFAULT = new Set(ACTIONS.map((x) => x[2]));
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'Alt Gr', Space: 'Space', Backquote: '`', CapsLock: 'Caps', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=' }[code] || code.replace('Numpad', 'Num ').replace('Arrow', '');
}
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.locked = false;
    this.wantLock = false;
    this.onKey = null;
    this.binds = {};
    try { this.binds = JSON.parse(localStorage.getItem('or_keys') || '{}') || {}; } catch {}
    this.physDown = new Map(); // physical key -> the logical codes it pressed
    this.capture = null;       // (code) => void while the controls menu waits for a key
    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f(e.code); return; }
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (['Tab', 'Space', 'ControlLeft', 'F1'].includes(e.code) || Object.values(this.binds).includes(e.code)) e.preventDefault();
      const L = this.logical(e.code);
      this.physDown.set(e.code, L);
      for (const c of L) {
        if (!this.keys.has(c)) this.pressed.add(c);
        this.keys.add(c);
        if (this.onKey) this.onKey(c, e);
      }
    });
    addEventListener('keyup', (e) => { for (const c of this.physDown.get(e.code) || [e.code]) this.keys.delete(c); this.physDown.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) { if (this.wantLock) this.lock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; if (this.onUnlock) this.onUnlock(); }
    });
  }
  // the default codes a physical key stands for: every action bound to it, or the key itself if it isn't an action key
  logical(code) {
    const out = [];
    for (const [a, , d] of ACTIONS) if ((this.binds[a] || d) === code) out.push(d);
    if (!out.length && !IS_DEFAULT.has(code)) out.push(code);
    return out;
  }
  bindOf(action) { return this.binds[action] || DEFAULT_OF[action]; }
  setBind(action, code) { if (code === DEFAULT_OF[action]) delete this.binds[action]; else this.binds[action] = code; this.saveBinds(); }
  resetBinds() { this.binds = {}; this.saveBinds(); }
  saveBinds() { try { localStorage.setItem('or_keys', JSON.stringify(this.binds)); } catch {} this.keys.clear(); this.physDown.clear(); }
  // '<kbd>E</kbd>' in prompts -> whatever key interact is bound to now
  relabel(html) {
    if (!Object.keys(this.binds).length) return html;
    return html.replace(/<kbd>([^<]{1,6})<\/kbd>/g, (m, k) => { const a = ACTIONS.find((x) => keyLabel(x[2]) === k); return a ? `<kbd>${keyLabel(this.bindOf(a[0]))}</kbd>` : m; });
  }
  lock() { this.wantLock = true; try { const p = this.el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} }
  unlock() { this.wantLock = false; if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.mouse.dx = this.mouse.dy = 0; this.mouse.leftPressed = this.mouse.rightPressed = false; this.mouse.wheel = 0; }
}
