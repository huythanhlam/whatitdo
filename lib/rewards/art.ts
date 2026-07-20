// Badge artwork: one filled, full-bleed illustrated scene per reward, in the
// flat community-badge style (a colored circular scene with a bold, readable
// subject) rather than thin line icons. Each value is the INNER markup of a
// 64x64 SVG (a base circle plus the subject); the frame clips it to a disc and
// adds the tier ring. Authored as raw SVG strings so the exact same art renders
// in the React components (via the Emblem wrapper) and in any static preview.
//
// Palette is shared and deliberately limited so the whole set reads as one
// family — warm cream, teal, navy, coral, gold, green, drawn from the app.

const C = {
  cream: '#F5EDD8', creamD: '#E7DBBB',
  teal: '#2F6E6B', tealD: '#244F4C',
  navy: '#22384A', navyD: '#182A38',
  coral: '#E86A61', coralL: '#F19089',
  gold: '#F2C24E', goldL: '#F8D477',
  green: '#6FA457', greenD: '#557E42',
  sky: '#CDE7E2', blush: '#F3B5A3',
  white: '#FFFFFF', ink: '#22303B',
  plum: '#8C4A5E', wood: '#8A5A3B',
}

// Shared 5-point star centred at (32,32).
const STAR = (fill: string) =>
  `<path d="M32 17 L35.8 26.7 46.3 27.4 38.2 34 40.8 44.1 32 38.5 23.2 44.1 25.8 34 17.7 27.4 28.2 26.7 Z" fill="${fill}"/>`

const base = (fill: string) => `<circle cx="32" cy="32" r="32" fill="${fill}"/>`

export const BADGE_ART_SVG: Record<string, string> = {
  // --- Getting started ---
  door:
    base(C.navy) +
    `<path d="M0 42 Q32 36 64 42 V64 H0 Z" fill="${C.teal}"/>` +
    `<path d="M21 46 V30 a11 11 0 0 1 22 0 V46 Z" fill="${C.cream}"/>` +
    `<path d="M32 46 V33 L42 27 V46 Z" fill="${C.gold}"/>` +
    `<path d="M21 46 V30 a11 11 0 0 1 11 -11 V46 Z" fill="${C.creamD}"/>` +
    `<circle cx="28.5" cy="35" r="1.5" fill="${C.navy}"/>`,
  compass:
    base(C.teal) +
    `<circle cx="32" cy="32" r="17" fill="${C.cream}"/>` +
    `<circle cx="32" cy="32" r="17" fill="none" stroke="${C.creamD}" stroke-width="2"/>` +
    `<path d="M32 19 L37 32 32 32 Z" fill="${C.coral}"/>` +
    `<path d="M32 45 L27 32 37 32 Z" fill="${C.navy}"/>` +
    `<circle cx="32" cy="32" r="2.4" fill="${C.navy}"/>`,
  envelope:
    base(C.coral) +
    `<circle cx="32" cy="32" r="27" fill="none" stroke="${C.gold}" stroke-width="1.5" stroke-dasharray="2 3.5"/>` +
    `<rect x="16" y="22" width="32" height="21" rx="3" fill="${C.cream}"/>` +
    `<path d="M16 24 L48 24 L32 35 Z" fill="${C.creamD}"/>` +
    `<path d="M16.5 23.5 L32 35 47.5 23.5" fill="none" stroke="${C.coral}" stroke-width="2.4" stroke-linejoin="round"/>`,
  'letter-check':
    base(C.tealD) +
    `<rect x="16" y="19" width="30" height="25" rx="2.5" fill="${C.cream}"/>` +
    `<path d="M21 26 H41 M21 31 H41 M21 36 H33" stroke="${C.creamD}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="43" cy="41" r="9" fill="${C.green}"/>` +
    `<path d="M39 41 L42 44 47 37.5" fill="none" stroke="${C.white}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,

  // --- Attendance (a visual escalation: one ticket -> a stack -> a venue -> a trophy) ---
  ticket:
    base(C.coral) +
    `<rect x="15" y="22" width="34" height="20" rx="3" fill="${C.cream}"/>` +
    `<circle cx="15" cy="32" r="3.4" fill="${C.coral}"/>` +
    `<circle cx="49" cy="32" r="3.4" fill="${C.coral}"/>` +
    `<path d="M38 24 V40" stroke="${C.creamD}" stroke-width="1.6" stroke-dasharray="2 2"/>` +
    `<path d="M27 27 L28.6 30.6 32.5 30.9 29.5 33.5 30.5 37.3 27 35.3 23.5 37.3 24.5 33.5 21.5 30.9 25.4 30.6 Z" fill="${C.teal}"/>` +
    `<path d="M41 29 H46 M41 33 H46" stroke="${C.creamD}" stroke-width="1.8" stroke-linecap="round"/>`,
  tickets:
    base(C.coral) +
    `<g transform="rotate(-13 32 34)"><rect x="17" y="28" width="30" height="15" rx="2.5" fill="${C.creamD}"/></g>` +
    `<g transform="rotate(-6 32 34)"><rect x="16" y="27" width="31" height="15" rx="2.5" fill="${C.cream}"/></g>` +
    `<rect x="15" y="25" width="33" height="17" rx="2.5" fill="${C.white}"/>` +
    `<circle cx="15" cy="33.5" r="3" fill="${C.coral}"/><circle cx="48" cy="33.5" r="3" fill="${C.coral}"/>` +
    `<path d="M39 26 V41" stroke="${C.creamD}" stroke-width="1.5" stroke-dasharray="2 2"/>` +
    `<path d="M24 29 L25.6 32.2 29 32.5 26.5 34.8 27.3 38 24 36.3 20.7 38 21.5 34.8 19 32.5 22.4 32.2 Z" fill="${C.teal}"/>`,
  marquee:
    base(C.navy) +
    `<path d="M14 24 L32 15 50 24 Z" fill="${C.goldL}"/>` +
    `<rect x="15" y="24" width="34" height="20" rx="2" fill="${C.cream}"/>` +
    `<rect x="19" y="28" width="26" height="12" rx="1" fill="${C.coral}"/>` +
    `<path d="M32 30 L33.3 33.2 36.7 33.4 34 35.6 35 38.9 32 37 29 38.9 30 35.6 27.3 33.4 30.7 33.2 Z" fill="${C.goldL}"/>` +
    `<g fill="${C.gold}"><circle cx="18" cy="24" r="1.3"/><circle cx="23" cy="24" r="1.3"/><circle cx="28" cy="24" r="1.3"/><circle cx="32" cy="24" r="1.3"/><circle cx="36" cy="24" r="1.3"/><circle cx="41" cy="24" r="1.3"/><circle cx="46" cy="24" r="1.3"/></g>` +
    `<rect x="22" y="44" width="3" height="6" fill="${C.creamD}"/><rect x="39" y="44" width="3" height="6" fill="${C.creamD}"/>`,
  trophy:
    base(C.navy) +
    `<path d="M23 19 H41 V24 A9 9 0 0 1 23 24 Z" fill="${C.gold}"/>` +
    `<path d="M23 20 C16 20 16 30 25 30" fill="none" stroke="${C.goldL}" stroke-width="2.4"/>` +
    `<path d="M41 20 C48 20 48 30 39 30" fill="none" stroke="${C.goldL}" stroke-width="2.4"/>` +
    `<rect x="30" y="32" width="4" height="6" fill="${C.goldL}"/>` +
    `<path d="M23 46 H41 L37.5 39 H26.5 Z" fill="${C.goldL}"/>` +
    `<path d="M32 21 L33.1 24 36.2 24.1 33.7 26 34.6 29 32 27.2 29.4 29 30.3 26 27.8 24.1 30.9 24 Z" fill="${C.white}"/>`,
  sunrise:
    base(C.blush) +
    `<path d="M32 22 V27 M19 27 L22 31 M45 27 L42 31 M12 35 H17 M47 35 H52" stroke="${C.goldL}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<circle cx="32" cy="41" r="12" fill="${C.gold}"/>` +
    `<path d="M0 41 Q32 35 64 41 V64 H0 Z" fill="${C.teal}"/>`,
  chevrons:
    base(C.navy) +
    `<circle cx="20" cy="20" r="1.4" fill="${C.cream}"/><circle cx="48" cy="18" r="1.2" fill="${C.cream}"/><circle cx="44" cy="46" r="1.2" fill="${C.cream}"/>` +
    `<path d="M15 44 L27 32 35 38 49 22" fill="none" stroke="${C.gold}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M42 22 H49 V29" fill="none" stroke="${C.gold}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,

  // --- First-of-type ---
  note:
    base(C.teal) +
    `<path d="M27 41 V22 L45 18 V37" fill="none" stroke="${C.gold}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="23.5" cy="41" r="5.2" fill="${C.gold}"/>` +
    `<circle cx="41.5" cy="37" r="5.2" fill="${C.gold}"/>`,
  mask:
    base(C.plum) +
    `<path d="M18 22 Q32 27 46 22 Q46 45 32 47 Q18 45 18 22 Z" fill="${C.cream}"/>` +
    `<circle cx="26" cy="31" r="2.2" fill="${C.plum}"/><circle cx="38" cy="31" r="2.2" fill="${C.plum}"/>` +
    `<path d="M25 37 Q32 44 39 37" fill="none" stroke="${C.plum}" stroke-width="2.4" stroke-linecap="round"/>`,
  plate:
    base(C.teal) +
    `<circle cx="35" cy="32" r="13" fill="${C.cream}"/><circle cx="35" cy="32" r="8" fill="${C.creamD}"/>` +
    `<path d="M16 20 V44 M13 20 V27 M19 20 V27" stroke="${C.gold}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
  frame:
    base(C.navy) +
    `<rect x="17" y="18" width="30" height="25" rx="2" fill="${C.cream}"/>` +
    `<rect x="20.5" y="21.5" width="23" height="18" fill="${C.teal}"/>` +
    `<circle cx="27" cy="27" r="2.6" fill="${C.gold}"/>` +
    `<path d="M20.5 39.5 L28 31 33 35 39 28 43.5 33 V39.5 Z" fill="${C.green}"/>`,
  ball:
    base(C.coral) +
    `<circle cx="32" cy="32" r="14" fill="${C.cream}"/>` +
    `<path d="M32 25 L38 29.5 35.8 36.5 28.2 36.5 26 29.5 Z" fill="${C.navy}"/>` +
    `<path d="M32 18 V25 M46 32 L38 29.5 M40 45 L35.8 36.5 M24 45 L28.2 36.5 M18 32 L26 29.5" stroke="${C.navy}" stroke-width="1.6"/>`,
  people:
    base(C.coral) +
    `<circle cx="25" cy="26" r="5.5" fill="${C.cream}"/><path d="M16 45 V39 a9 9 0 0 1 18 0 V45 Z" fill="${C.cream}"/>` +
    `<circle cx="41" cy="30" r="4.5" fill="${C.gold}"/><path d="M33 45 V40 a8 8 0 0 1 16 0 V45 Z" fill="${C.gold}"/>`,
  burst:
    base(C.navy) +
    STAR(C.gold) +
    `<circle cx="17" cy="19" r="2" fill="${C.coral}"/><rect x="45" y="16" width="3.4" height="3.4" rx="1" transform="rotate(20 46 18)" fill="${C.teal}"/>` +
    `<circle cx="48" cy="45" r="2" fill="${C.cream}"/><circle cx="16" cy="45" r="2" fill="${C.green}"/>`,
  reel:
    base(C.navy) +
    `<circle cx="32" cy="29" r="14" fill="${C.cream}"/><circle cx="32" cy="29" r="3.2" fill="${C.navy}"/>` +
    `<circle cx="32" cy="21" r="2.6" fill="${C.navy}"/><circle cx="39" cy="29" r="2.6" fill="${C.navy}"/><circle cx="32" cy="37" r="2.6" fill="${C.navy}"/><circle cx="25" cy="29" r="2.6" fill="${C.navy}"/>` +
    `<rect x="26" y="43" width="24" height="9" rx="1" fill="${C.teal}"/><path d="M29 45 v5 M34 45 v5 M39 45 v5 M44 45 v5" stroke="${C.cream}" stroke-width="1.4"/>`,
  mountain:
    base(C.sky) +
    `<circle cx="44" cy="21" r="6" fill="${C.gold}"/>` +
    `<path d="M0 50 L16 30 30 48 Z" fill="${C.greenD}"/>` +
    `<path d="M20 50 L38 22 56 50 Z" fill="${C.teal}"/>` +
    `<path d="M38 22 L44 31 38 33.5 32 31 Z" fill="${C.cream}"/>` +
    `<path d="M0 48 Q32 44 64 48 V64 H0 Z" fill="${C.green}"/>`,
  nodes:
    base(C.navy) +
    `<path d="M22 24 L42 30 M22 24 L30 44 M42 30 L30 44" stroke="${C.teal}" stroke-width="2.2"/>` +
    `<circle cx="22" cy="24" r="5" fill="${C.coral}"/><circle cx="42" cy="30" r="5" fill="${C.gold}"/><circle cx="30" cy="44" r="5" fill="${C.green}"/>`,
  star:
    base(C.teal) + STAR(C.gold),

  // --- First-of-type: aggregate ---
  wheel:
    base(C.cream) +
    `<path d="M32 32 L47 32 A15 15 0 0 1 39.5 45 Z" fill="${C.teal}"/>` +
    `<path d="M32 32 L39.5 45 A15 15 0 0 1 24.5 45 Z" fill="${C.coral}"/>` +
    `<path d="M32 32 L24.5 45 A15 15 0 0 1 17 32 Z" fill="${C.gold}"/>` +
    `<path d="M32 32 L17 32 A15 15 0 0 1 24.5 19 Z" fill="${C.green}"/>` +
    `<path d="M32 32 L24.5 19 A15 15 0 0 1 39.5 19 Z" fill="${C.navy}"/>` +
    `<path d="M32 32 L39.5 19 A15 15 0 0 1 47 32 Z" fill="${C.plum}"/>` +
    `<circle cx="32" cy="32" r="4.5" fill="${C.cream}"/>`,
  grid:
    base(C.navy) +
    `<circle cx="22" cy="22" r="4" fill="${C.gold}"/><circle cx="32" cy="22" r="4" fill="${C.coral}"/><circle cx="42" cy="22" r="4" fill="${C.teal}"/>` +
    `<circle cx="22" cy="32" r="4" fill="${C.coral}"/><circle cx="32" cy="32" r="4" fill="${C.gold}"/><circle cx="42" cy="32" r="4" fill="${C.green}"/>` +
    `<circle cx="22" cy="42" r="4" fill="${C.teal}"/><circle cx="32" cy="42" r="4" fill="${C.green}"/><circle cx="42" cy="42" r="4" fill="${C.gold}"/>`,

  // --- Taste ---
  bookmark:
    base(C.teal) +
    `<path d="M23 16 H41 V48 L32 41 L23 48 Z" fill="${C.coral}"/>` +
    `<path d="M23 16 H41 V21 H23 Z" fill="${C.coralL}"/>`,
  calendar:
    base(C.coral) +
    `<rect x="16" y="20" width="32" height="26" rx="3" fill="${C.cream}"/>` +
    `<path d="M16 27 H48" stroke="${C.creamD}" stroke-width="1.5"/>` +
    `<rect x="16" y="20" width="32" height="7" rx="3" fill="${C.teal}"/>` +
    `<rect x="22" y="16" width="3" height="7" rx="1.5" fill="${C.navy}"/><rect x="39" y="16" width="3" height="7" rx="1.5" fill="${C.navy}"/>` +
    `<path d="M26 37 L31 42 40 31" fill="none" stroke="${C.green}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  magnifier:
    base(C.navy) +
    `<path d="M36 36 L47 47" stroke="${C.gold}" stroke-width="4.5" stroke-linecap="round"/>` +
    `<circle cx="29" cy="29" r="11" fill="${C.sky}"/>` +
    `<circle cx="29" cy="29" r="11" fill="none" stroke="${C.gold}" stroke-width="3.4"/>`,

  // --- Social ---
  megaphone:
    base(C.coral) +
    `<path d="M40 24 q6 8 0 16" fill="none" stroke="${C.gold}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M46 20 q10 12 0 24" fill="none" stroke="${C.gold}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M14 28 L34 21 V43 L14 36 Z" fill="${C.cream}"/>` +
    `<rect x="10" y="28" width="6" height="8" rx="1.5" fill="${C.creamD}"/>` +
    `<path d="M20 38 V44 a3 3 0 0 0 6 0 V40 Z" fill="${C.creamD}"/>`,

  // --- Loyalty ---
  rings:
    base(C.sky) +
    `<path d="M0 47 Q32 43 64 47 V64 H0 Z" fill="${C.green}"/>` +
    `<rect x="30" y="34" width="4" height="13" fill="${C.wood}"/>` +
    `<circle cx="24" cy="31" r="8" fill="${C.greenD}"/><circle cx="40" cy="31" r="8" fill="${C.greenD}"/>` +
    `<circle cx="32" cy="25" r="11" fill="${C.green}"/>`,
  rosette:
    base(C.navy) +
    `<path d="M27 33 L23 49 L30 45 L32 49 L34 45 L41 49 L37 33 Z" fill="${C.coral}"/>` +
    `<g fill="${C.gold}"><circle cx="32" cy="18" r="4"/><circle cx="41" cy="21" r="4"/><circle cx="44" cy="29" r="4"/><circle cx="39" cy="35" r="4"/><circle cx="25" cy="35" r="4"/><circle cx="20" cy="29" r="4"/><circle cx="23" cy="21" r="4"/></g>` +
    `<circle cx="32" cy="27" r="9" fill="${C.goldL}"/><circle cx="32" cy="27" r="5.5" fill="${C.gold}"/>` +
    `<path d="M32 23 L33.4 26.6 37.3 26.8 34.2 29.2 35.3 33 32 30.7 28.7 33 29.8 29.2 26.7 26.8 30.6 26.6 Z" fill="${C.white}"/>`,
  medal:
    base(C.teal) +
    `<path d="M24 20 L28 30 M40 20 L36 30" stroke="${C.coral}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="32" cy="36" r="11" fill="${C.gold}"/>` +
    `<circle cx="32" cy="36" r="11" fill="none" stroke="${C.goldL}" stroke-width="2"/>` +
    `<path d="M32 31 L33.6 35.2 38.1 35.4 34.6 38.1 35.9 42.4 32 39.8 28.1 42.4 29.4 38.1 25.9 35.4 30.4 35.2 Z" fill="${C.white}"/>`,
}

export function hasArt(key: string): boolean {
  return key in BADGE_ART_SVG
}
