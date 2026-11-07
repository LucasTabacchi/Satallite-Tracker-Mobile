import { parseElements, type Elements } from '../orbit';

/** Decodes CelesTrak OMM CSV without changing the validation used for JSON rows. */
export function parseCelesTrakCsv(text: string): Elements[] {
  let header: string[] | undefined;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const elements: Elements[] = [];
  const invalid = () => new Error('Upstream returned an invalid OMM CSV catalog');
  const pushField = () => { row.push(field); field = ''; closedQuote = false; };
  const pushRow = () => {
    pushField();
    if (row.length !== 1 || row[0] !== '') {
      if (!header) {
        if (row.some(name => !name) || new Set(row).size !== row.length) throw invalid();
        header = row;
      } else {
        if (row.length !== header.length) throw invalid();
        elements.push(parseElements(Object.fromEntries(header.map((name, index) => [name, row[index]]))));
      }
    }
    row = [];
  };

  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') {
      pushRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else if (closedQuote) throw invalid();
    else if (char === '"') {
      if (field) throw invalid();
      quoted = true;
    } else field += char;
  }
  if (quoted) throw invalid();
  if (row.length || field || closedQuote) pushRow();
  if (!elements.length) throw invalid();
  return elements;
}
