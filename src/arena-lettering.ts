// Original-style, squared monoline lettering drawn locally for match announcements.
// These are our own glyphs, not a redistributed copy of the game's commercial font.
const glyphs: Record<string, [number, string]> = {
  A: [27, 'M2 33V7Q2 3 6 3H21Q25 3 25 7V33M2 19H25'],
  B: [27, 'M2 33V3H19Q25 3 25 9V12Q25 18 19 18H2M19 18Q25 18 25 24V27Q25 33 19 33H2'],
  C: [27, 'M25 3H7Q2 3 2 8V28Q2 33 7 33H25'],
  D: [28, 'M2 33V3H19Q26 3 26 10V26Q26 33 19 33Z'],
  E: [25, 'M23 3H2V33H23M2 18H21'],
  F: [25, 'M23 3H2V33M2 18H21'],
  G: [28, 'M26 3H7Q2 3 2 8V28Q2 33 7 33H26V19H16'],
  H: [28, 'M2 3V33M26 3V33M2 18H26'],
  I: [7, 'M3.5 3V33'],
  J: [24, 'M22 3V28Q22 33 17 33H6Q2 33 2 29V25'],
  K: [27, 'M2 3V33M25 3L2 18L25 33'],
  L: [24, 'M2 3V33H22'],
  M: [34, 'M2 33V3L17 23L32 3V33'],
  N: [29, 'M2 33V3L27 33V3'],
  O: [28, 'M7 3H21Q26 3 26 8V28Q26 33 21 33H7Q2 33 2 28V8Q2 3 7 3Z'],
  P: [27, 'M2 33V3H20Q25 3 25 8V14Q25 19 20 19H2'],
  Q: [28, 'M7 3H21Q26 3 26 8V28Q26 33 21 33H7Q2 33 2 28V8Q2 3 7 3ZM18 25L28 35'],
  R: [28, 'M2 33V3H20Q25 3 25 8V13Q25 18 20 18H2M16 18L26 33'],
  S: [27, 'M25 3H7Q2 3 2 8V13Q2 18 7 18H20Q25 18 25 23V28Q25 33 20 33H2'],
  T: [26, 'M1 3H25M13 3V33'],
  U: [28, 'M2 3V28Q2 33 7 33H21Q26 33 26 28V3'],
  V: [28, 'M2 3L14 33L26 3'],
  W: [38, 'M2 3L10 33L19 15L28 33L36 3'],
  X: [28, 'M2 3L26 33M26 3L2 33'],
  Y: [28, 'M2 3L14 19L26 3M14 19V33'],
  Z: [27, 'M2 3H25L2 33H25'],
  '0': [28, 'M7 3H21Q26 3 26 8V28Q26 33 21 33H7Q2 33 2 28V8Q2 3 7 3Z'],
  '1': [14, 'M2 8L11 3V33'],
  '2': [27, 'M2 3H20Q25 3 25 8V13Q25 18 20 18H7Q2 18 2 23V33H25'],
  '3': [27, 'M2 3H20Q25 3 25 8V13Q25 18 20 18H7M20 18Q25 18 25 23V28Q25 33 20 33H2'],
  '4': [27, 'M2 3V19H25M22 3V33'],
  '5': [27, 'M25 3H2V18H20Q25 18 25 23V28Q25 33 20 33H2'],
  '6': [27, 'M25 3H7Q2 3 2 8V28Q2 33 7 33H20Q25 33 25 28V23Q25 18 20 18H2'],
  '7': [27, 'M2 3H25L12 33'],
  '8': [27, 'M7 18Q2 18 2 13V8Q2 3 7 3H20Q25 3 25 8V13Q25 18 20 18ZM7 18Q2 18 2 23V28Q2 33 7 33H20Q25 33 25 28V23Q25 18 20 18'],
  '9': [27, 'M2 33H20Q25 33 25 28V8Q25 3 20 3H7Q2 3 2 8V13Q2 18 7 18H25'],
  '!': [7, 'M3.5 3V24M3.5 32V33'],
  '.': [7, 'M3.5 32V33'],
  '·': [7, 'M3.5 17V18'],
  '+': [22, 'M2 18H20M11 9V27'],
  '-': [18, 'M2 18H16'],
  ':': [7, 'M3.5 12V13M3.5 27V28'],
  ' ': [13, ''],
};

export function arenaLettering(value: string) {
  let width = 0;
  const paths = [...value.toUpperCase()].map(char => {
    const [advance, path] = glyphs[char] ?? glyphs[' '];
    const result = path ? `<path transform="translate(${width} 0)" d="${path}"/>` : '';
    width += advance + 3;
    return result;
  }).join('');
  return `<svg class="arena-lettering" viewBox="0 0 ${Math.max(1, width)} 36" style="width:${width / 36}em" aria-hidden="true">${paths}</svg>`;
}

// A translucent, irregular sunburst, with warm central light behind the award.
export const goalAward = `<div class="goal-award" aria-label="Goal, plus 100 points">
  <svg class="goal-starburst" viewBox="0 0 160 160" aria-hidden="true"><defs><radialGradient id="goal-amber"><stop stop-color="#ffd457" stop-opacity=".85"/><stop offset=".42" stop-color="#e99513" stop-opacity=".6"/><stop offset="1" stop-color="#df8a10" stop-opacity="0"/></radialGradient></defs>
  <path fill="url(#goal-amber)" d="M80 3L89 41L106 20L104 52L143 35L117 66L158 78L116 89L139 113L105 108L106 146L87 121L76 159L66 117L42 142L47 106L9 120L38 88L0 76L39 65L18 39L54 49L51 11L72 40Z"/>
  <path fill="#eaa51d" opacity=".15" d="M79 19L89 57L121 36L106 70L144 81L107 94L123 126L91 110L79 145L67 109L33 128L51 93L15 80L52 69L37 36L68 56Z"/></svg>
  <span class="goal-award-label">${arenaLettering('GOAL')}</span><span class="goal-award-points">${arenaLettering('+100')}</span>
</div>`;
