import * as vscode from "vscode";
import { getWikilinkAtPosition, resolveNoteFile } from "../wikilinks";

/** Permite Ctrl+Click / F12 sobre un wikilink para saltar al archivo de nota. */
export class WikilinkDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    const wikilink = getWikilinkAtPosition(document, position);
    if (!wikilink) {
      return undefined;
    }

    const note = await resolveNoteFile(wikilink.noteName);
    if (!note) {
      return undefined;
    }

    return new vscode.Location(note.uri, new vscode.Position(0, 0));
  }
}
