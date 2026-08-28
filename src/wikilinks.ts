import * as path from "path";
import * as vscode from "vscode";

/** Coincide con [[nota]], [[nota#seccion]], [[nota|alias]] y combinaciones. */
export const WIKILINK_REGEX = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;

export interface NoteFile {
  uri: vscode.Uri;
  /** Nombre de archivo sin extensión, usado como identificador del wikilink. */
  name: string;
}

function getNoteExtensions(): string[] {
  const config = vscode.workspace.getConfiguration("obsidianlikeLinks");
  return config.get<string[]>("noteExtensions", ["md"]);
}

/** Busca todos los archivos de nota del workspace (excluyendo node_modules). */
export async function findNoteFiles(): Promise<NoteFile[]> {
  const extensions = getNoteExtensions();
  const pattern = `**/*.{${extensions.join(",")}}`;
  const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");

  return uris.map((uri) => ({
    uri,
    name: path.basename(uri.fsPath, path.extname(uri.fsPath)),
  }));
}

/**
 * Normaliza el destino de un wikilink a su nombre de nota resoluble: Obsidian
 * admite `[[carpeta/nota]]` y `[[carpeta/nota.md]]` además de `[[nota]]`, pero
 * la resolución aquí es por nombre de archivo sin extensión, así que se descarta
 * el directorio y una extensión de nota final si la hubiera.
 */
export function wikilinkTargetName(rawName: string): string {
  const lastSegment = rawName.trim().split(/[/\\]/).pop() ?? "";
  const ext = path.extname(lastSegment).slice(1).toLowerCase();
  return ext && getNoteExtensions().includes(ext)
    ? lastSegment.slice(0, -(ext.length + 1))
    : lastSegment;
}

/**
 * Clave canónica para comparar nombres de nota. Dos nombres que en pantalla se
 * ven idénticos pueden diferir en bytes y romper una comparación `===`; esta
 * función neutraliza los casos que hemos visto en bóvedas reales:
 * - **Normalización Unicode NFC**: un nombre de archivo en forma descompuesta
 *   (`é` como `e` + acento combinado, habitual si el archivo viene de macOS) vs.
 *   el mismo texto precompuesto en el wikilink. Obsidian normaliza a NFC igual.
 * - **Selectores de variación y caracteres de ancho cero** (`U+FE0E`/`U+FE0F`,
 *   `U+200B`–`U+200D`, `U+2060`, `U+FEFF`): un emoji en el nombre puede llevar o
 *   no el selector `U+FE0F` según cómo se tecleara; son invisibles y se descartan.
 * - **Espacios**: cualquier espacio Unicode (incluido el duro `U+00A0`, que
 *   produce Opción+Espacio en Mac) se colapsa a un espacio normal.
 * Úsalo en cualquier comparación de `noteName`.
 */
const IGNORABLE_IN_NAME = /[︎️​‌‍⁠﻿]/g;

export function noteNameKey(name: string): string {
  return name
    .normalize("NFC")
    .replace(IGNORABLE_IN_NAME, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Lista los code points de un string en hex, para diagnóstico en `log.ts`. */
export function describeCodepoints(value: string): string {
  return Array.from(value)
    .map((ch) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
    .join(" ");
}

/** Resuelve el archivo de nota cuyo nombre coincide (sin distinguir mayúsculas). */
export async function resolveNoteFile(name: string): Promise<NoteFile | undefined> {
  const notes = await findNoteFiles();
  const target = noteNameKey(wikilinkTargetName(name));
  return notes.find((note) => noteNameKey(note.name) === target);
}

export interface WikilinkAtPosition {
  /** Nombre de la nota referenciada, sin la sección ni el alias. */
  noteName: string;
  range: vscode.Range;
}

/** Detecta si hay un wikilink en la posición dada y devuelve su rango y nombre de nota. */
export function getWikilinkAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): WikilinkAtPosition | undefined {
  const line = document.lineAt(position.line).text;
  WIKILINK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKILINK_REGEX.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position.character >= start && position.character <= end) {
      return {
        noteName: match[1].trim(),
        range: new vscode.Range(position.line, start, position.line, end),
      };
    }
  }
  return undefined;
}

/** Extrae todos los wikilinks presentes en el texto de un documento. */
export function extractWikilinks(text: string): string[] {
  return extractWikilinksDetailed(text).map((link) => link.noteName);
}

export interface WikilinkMatch {
  noteName: string;
  /** true si es una transclusión (![[nota]]) en vez de un enlace normal ([[nota]]). */
  isEmbed: boolean;
  /** Offset en el texto donde comienza el wikilink (incluye el "!" si es transclusión). */
  index: number;
}

/** Extrae todos los wikilinks de un texto, indicando si son transclusiones (![[nota]]). */
export function extractWikilinksDetailed(text: string): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];
  WIKILINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const isEmbed = match.index > 0 && text[match.index - 1] === "!";
    matches.push({
      noteName: match[1].trim(),
      isEmbed,
      index: isEmbed ? match.index - 1 : match.index,
    });
  }
  return matches;
}
