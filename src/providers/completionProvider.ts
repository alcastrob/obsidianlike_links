import * as vscode from "vscode";
import { findNoteFiles } from "../wikilinks";

/** Sugiere notas del workspace al escribir "[[". */
export class WikilinkCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    if (!linePrefix.match(/\[\[[^\]]*$/)) {
      return undefined;
    }

    const notes = await findNoteFiles();
    return notes.map((note) => {
      const item = new vscode.CompletionItem(note.name, vscode.CompletionItemKind.File);
      item.insertText = `${note.name}]]`;
      item.detail = vscode.workspace.asRelativePath(note.uri);
      return item;
    });
  }
}
