import * as vscode from "vscode";
import { getWikilinkAtPosition, resolveNoteFile } from "../wikilinks";

const PREVIEW_LINE_COUNT = 10;

/** Muestra una vista previa del contenido de la nota al pasar el cursor sobre un wikilink. */
export class WikilinkHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const wikilink = getWikilinkAtPosition(document, position);
    if (!wikilink) {
      return undefined;
    }

    const note = await resolveNoteFile(wikilink.noteName);
    if (!note) {
      const message = new vscode.MarkdownString(`⚠️ Nota no encontrada: **${wikilink.noteName}**`);
      return new vscode.Hover(message, wikilink.range);
    }

    const targetDocument = await vscode.workspace.openTextDocument(note.uri);
    const previewLines = targetDocument.getText().split(/\r?\n/).slice(0, PREVIEW_LINE_COUNT);
    const preview = new vscode.MarkdownString(previewLines.join("\n"));
    preview.isTrusted = false;

    return new vscode.Hover(preview, wikilink.range);
  }
}
