// Thin, wide arena numerals. Text remains available to accessibility and tests.
const paths: Record<string, string> = {
  '0': 'M7 3 H34 Q38 3 38 7 V29 Q38 33 34 33 H7 Q3 33 3 29 V7 Q3 3 7 3 Z',
  '1': 'M8 8 L17 3 V33',
  '2': 'M3 3 H33 Q38 3 38 8 V14 Q38 18 33 18 H8 Q3 18 3 23 V33 H38',
  '3': 'M3 3 H33 Q38 3 38 8 V13 Q38 18 33 18 H10 M33 18 Q38 18 38 23 V28 Q38 33 33 33 H3',
  '4': 'M3 3 V18 H38 M34 3 V33',
  '5': 'M38 3 H3 V18 H33 Q38 18 38 23 V28 Q38 33 33 33 H3',
  '6': 'M38 3 H8 Q3 3 3 8 V28 Q3 33 8 33 H33 Q38 33 38 28 V23 Q38 18 33 18 H3',
  '7': 'M3 3 H38 L19 33',
  '8': 'M8 18 Q3 18 3 13 V8 Q3 3 8 3 H33 Q38 3 38 8 V13 Q38 18 33 18 Z M8 18 Q3 18 3 23 V28 Q3 33 8 33 H33 Q38 33 38 28 V23 Q38 18 33 18',
  '9': 'M3 33 H33 Q38 33 38 28 V8 Q38 3 33 3 H8 Q3 3 3 8 V13 Q3 18 8 18 H38',
  ':': 'M5 13 H5.2 M5 25 H5.2',
  '+': 'M3 18 H23 M13 8 V28',
};
export function scoreNumerals(value: string) {
  let width = 0;
  const glyphs = [...value].map(digit => {
    const path = `<path transform="translate(${width} 0)"${digit === ':' ? ' stroke-width="2.2"' : ''} d="${paths[digit] ?? ''}"/>`;
    width += digit === ':' ? 13 : digit === '+' ? 29 : digit === '1' ? 24 : 43;
    return path;
  }).join('');
  return `<span class="score-number-text">${value}</span><svg viewBox="0 0 ${width} 36" style="width:${width / 36}em" aria-hidden="true">${glyphs}</svg>`;
}
