// The look plan, in one place. DUSTLINE is a dusk-lit industrial yard: cold concrete and
// steel, warm sodium lamps, and two team colours that read at a glance — Vanguard teal
// against Ember orange. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0e1116',
  surface: '#252c36',
  hairline: '#3a434f',
  floor: '#2e3540',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f0a830',
  vanguard: '#2fd4c0',
  ember: '#f06423',
  danger: '#e5484d',
  money: '#7fd08a',
};

export function shade(name) {
  return PALETTE[name];
}
