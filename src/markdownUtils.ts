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

// `\p{L}`/`\p{N}` (con flag `u`) en vez de `\w` para que las etiquetas con acentos
// (#administración, #económico) no se trunquen en la primera letra no-ASCII.
const TAG_REGEX = /(^|[^\p{L}\p{N}_#/])#([\p{L}][\p{L}\p{N}_/-]*)/gu;

// Códigos de color hex (p.ej. `background-color:#e3ff00;` del highlight de
// `obsidianlike`) no son etiquetas aunque tengan la forma de una: si justo antes
// del `#` hay una declaración CSS `...color:`, se descarta el match.
const CSS_COLOR_BEFORE_HASH = /[\w-]*color\s*:\s*$/i;

/** Extrae etiquetas #tag de un texto (excluye encabezados y bloques de código). */
export function extractTags(text: string): TagMatch[] {
  const clean = stripFencedCodeBlocks(text);
  const matches: TagMatch[] = [];
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(clean)) !== null) {
    const tagStart = match.index + match[1].length;
    const context = clean.slice(Math.max(0, tagStart - 30), tagStart);
    if (CSS_COLOR_BEFORE_HASH.test(context)) {
      continue;
    }
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
