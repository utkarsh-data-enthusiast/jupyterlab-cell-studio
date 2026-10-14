/** Pure, deterministic notebook section helpers. No network or storage. */
export interface SectionCell {
  type: 'code' | 'markdown' | 'raw';
  source: string;
}

/** Find a heading at the start of any Markdown line. Ignore fenced code blocks. */
export function headingLevel(source: string): number | null {
  let fence: string | null = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1].charAt(0);
      else if (marker[1].charAt(0) === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(line);
    if (heading) return heading[1].length;
  }
  return null;
}

/** Inclusive start, exclusive end. A section ends at the next heading of equal/higher rank. */
export function sectionBounds(cells: SectionCell[], index: number): [number, number] {
  if (index < 0 || index >= cells.length) throw new RangeError('Cell out of bounds');
  let start = index;
  let level: number | null = null;
  for (let i = index; i >= 0; i--) {
    const l = cells[i].type === 'markdown' ? headingLevel(cells[i].source) : null;
    if (l !== null) {
      start = i;
      level = l;
      break;
    }
  }
  // If no heading exists above the current cell, treat the preamble as a section.
  if (level === null) {
    for (let i = index + 1; i < cells.length; i++) {
      if (cells[i].type === 'markdown' && headingLevel(cells[i].source) !== null) return [0, i];
    }
    return [0, cells.length];
  }
  for (let i = start + 1; i < cells.length; i++) {
    const candidate = cells[i].type === 'markdown' ? headingLevel(cells[i].source) : null;
    if (candidate !== null && candidate <= level) return [start, i];
  }
  return [start, cells.length];
}

export function firstExecutableLine(code: string): number | null {
  const lines = code.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) return i + 1;
  }
  return null;
}
