import * as vscode from "vscode";
import { ActiveMarkdownDocumentTracker } from "./activeMarkdownDocument";
import { log, outputChannel } from "./log";
import { WikilinkCompletionProvider } from "./providers/completionProvider";
import { WikilinkDefinitionProvider } from "./providers/definitionProvider";
import { WikilinkHoverProvider } from "./providers/hoverProvider";
import { PanelViewProvider } from "./views/panelViewProvider";
import { findNoteFiles } from "./wikilinks";

const MARKDOWN_SELECTOR: vscode.DocumentSelector = { language: "markdown" };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(outputChannel);
  log("activate()");
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      MARKDOWN_SELECTOR,
      new WikilinkCompletionProvider(),
      "["
    ),
    vscode.languages.registerDefinitionProvider(MARKDOWN_SELECTOR, new WikilinkDefinitionProvider()),
    vscode.languages.registerHoverProvider(MARKDOWN_SELECTOR, new WikilinkHoverProvider())
  );

  const tracker = new ActiveMarkdownDocumentTracker(context);
  const panelViewProvider = new PanelViewProvider(tracker, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("obsidianlikeLinks.panelView", panelViewProvider),
    vscode.commands.registerCommand("obsidianlikeLinks.refresh", () => panelViewProvider.refresh()),
    vscode.commands.registerCommand("obsidianlikeLinks.insertLink", () => insertWikilink())
  );
}

export function deactivate(): void {
  // Nada que limpiar: todos los listeners se registran en context.subscriptions.
}

async function insertWikilink(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const notes = await findNoteFiles();
  const picked = await vscode.window.showQuickPick(
    notes.map((note) => ({ label: note.name, description: vscode.workspace.asRelativePath(note.uri) })),
    { placeHolder: "Selecciona una nota para enlazar" }
  );
  if (!picked) {
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, `[[${picked.label}]]`);
  });
}
