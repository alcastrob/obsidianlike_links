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

/** Resuelve el archivo de nota cuyo nombre coincide (sin distinguir mayúsculas). */
export async function resolveNoteFile(name: string): Promise<NoteFile | undefined> {
  const notes = await findNoteFiles();
  const target = wikilinkTargetName(name).toLowerCase();
  return notes.find((note) => note.name.toLowerCase() === target);
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
