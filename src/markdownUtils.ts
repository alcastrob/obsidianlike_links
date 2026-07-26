/** Reemplaza el contenido de los bloques de código ``` por líneas en blanco, preservando el número de línea. */
function stripFencedCodeBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  return lines
    .map((line) => {
      const isFenceMarker = /^\s*```/.test(line);
      if (isFenceMarker) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

export interface TagMatch {
  tag: string;
  index: number;
}

const TAG_REGEX = /(^|[^\w#/])#([A-Za-z][\w/-]*)/g;

/** Extrae etiquetas #tag de un texto (excluye encabezados y bloques de código). */
export function extractTags(text: string): TagMatch[] {
  const clean = stripFencedCodeBlocks(text);
  const matches: TagMatch[] = [];
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(clean)) !== null) {
    const tagStart = match.index + match[1].length;
    matches.push({ tag: match[2], index: tagStart });
  }
  return matches;
}

/** Extrae las claves de primer nivel del frontmatter YAML (entre --- iniciales). */
export function extractFrontmatterKeys(text: string): string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    return [];
  }

  const keys: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const keyMatch = /^([A-Za-z0-9_-]+):/.exec(line);
    if (keyMatch) {
      keys.push(keyMatch[1]);
    }
  }
  return keys;
}

export interface HeadingMatch {
  level: number;
  title: string;
  line: number;
}

/** Extrae los encabezados Markdown (#, ##, ...) de un texto, en orden de aparición. */
export function extractHeadings(text: string): HeadingMatch[] {
  const clean = stripFencedCodeBlocks(text);
  const headings: HeadingMatch[] = [];
  clean.split(/\r?\n/).forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, title: match[2], line: index });
    }
  });
  return headings;
}
