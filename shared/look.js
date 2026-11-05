// Character appearance options (shared so the server can validate and clients can render).
export const LOOK_FIELDS = [
  { key: 'body', label: 'Body', names: ['Masculine', 'Feminine'] },
  { key: 'height', label: 'Height', names: ['Short', 'Below average', 'Average', 'Tall', 'Very tall'] },
  { key: 'skin', label: 'Skin tone', colors: [0xf6d3b8, 0xeec1a0, 0xe0ac85, 0xc98e66, 0xa86f4b, 0x8a5636, 0x6b3f25, 0x4a2a18] },
  { key: 'hair', label: 'Hair', names: ['Bald', 'Buzz cut', 'Short', 'Messy', 'Long', 'Ponytail', 'Mohawk', 'Bun'] },
  { key: 'hairColor', label: 'Hair colour', colors: [0x1b1612, 0x3b2a1e, 0x6a4a2e, 0x9a6a3a, 0xc9a36a, 0xe2cfa0, 0x9a2e1e, 0x8a8a8a, 0xeaeaea, 0x3a6ad0, 0xd04a8a] },
  { key: 'beard', label: 'Facial hair', names: ['None', 'Stubble', 'Full beard', 'Moustache', 'Goatee'] },
  { key: 'eyes', label: 'Eye colour', colors: [0x3a2a1a, 0x2a5aa0, 0x3a7a4a, 0x6a6a6a, 0x8a5a2a, 0x1a1a1a] },
  { key: 'top', label: 'Top', names: ['T-shirt', 'Long sleeve', 'Hoodie', 'Tank top', 'Jacket'] },
  { key: 'topColor', label: 'Top colour', colors: [0xe8e4dc, 0x2a2a2a, 0x8a2a2a, 0x2a4a8a, 0x3a6a3a, 0xc8a040, 0x6a3a8a, 0xd06a2a, 0x4a6a7a, 0x9a8a6a, 0xd04a6a, 0x3a8a8a] },
  { key: 'pants', label: 'Legs', names: ['Jeans', 'Cargo pants', 'Shorts', 'Joggers'] },
  { key: 'pantsColor', label: 'Legs colour', colors: [0x2a3a5a, 0x1e1e1e, 0x5a4a3a, 0x6a6a5a, 0x8a7a5a, 0x3a4a2a, 0x7a2a2a, 0xc8c0b0, 0x4a4a5a, 0x2a5a6a] },
  { key: 'shoes', label: 'Shoes', colors: [0x1a1a1a, 0xe8e8e8, 0x5a3a22, 0x8a2a2a, 0x2a3a6a, 0x6a6a3a] },
];

export const DEFAULT_LOOK = { body: 0, height: 2, skin: 2, hair: 2, hairColor: 1, beard: 0, eyes: 0, top: 0, topColor: 3, pants: 0, pantsColor: 0, shoes: 0 };

const count = (f) => (f.names || f.colors).length;

export function sanitizeLook(l) {
  const out = {};
  for (const f of LOOK_FIELDS) {
    const v = Number(l && l[f.key]);
    out[f.key] = Number.isInteger(v) && v >= 0 && v < count(f) ? v : DEFAULT_LOOK[f.key];
  }
  return out;
}
export function randomLook() {
  const out = {};
  for (const f of LOOK_FIELDS) out[f.key] = Math.floor(Math.random() * count(f));
  out.height = 1 + Math.floor(Math.random() * 3);
  if (out.body === 1 && Math.random() < 0.85) out.beard = 0;
  return out;
}
export function lookOptions(f) { return count(f); }
// compact string for network snapshots
export function encodeLook(l) { return LOOK_FIELDS.map((f) => l[f.key].toString(36)).join(''); }
export function decodeLook(s) {
  const out = {};
  LOOK_FIELDS.forEach((f, i) => (out[f.key] = parseInt((s || '')[i] || '0', 36) || 0));
  return sanitizeLook(out);
}
export function lookColor(l, key) { return LOOK_FIELDS.find((f) => f.key === key).colors[l[key]]; }
