import * as vscode from "vscode";

/** Extrae la Uri del archivo de una pestaña, sea cual sea el tipo de editor que la muestre. */
function getTabUri(input: unknown): vscode.Uri | undefined {
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom ||
    input instanceof vscode.TabInputNotebook
  ) {
    return input.uri;
  }
  return undefined;
}

/**
 * Documento Markdown de la pestaña activa. Deliberadamente NO usa
 * `vscode.window.activeTextEditor` (pasa a `undefined` en cuanto el foco sale
 * de un editor de texto, p.ej. al hacer clic en este mismo panel). En su lugar
 * usa la pestaña activa de `vscode.window.tabGroups`, que no depende del foco.
 *
 * Tampoco exige que la pestaña sea un editor de texto plano (`TabInputText`):
 * un archivo .md puede mostrarse con un editor personalizado (`TabInputCustom`,
 * p.ej. de otra extensión "Obsidian like" instalada) y sigue siendo el mismo
 * archivo. Se resuelve la Uri con `openTextDocument` (idempotente: si ya está
 * abierto devuelve la misma instancia al instante) en vez de compararla a mano
 * contra `workspace.textDocuments`, para evitar falsos negativos por
 * diferencias de mayúsculas/codificación en la URI.
 */
export class ActiveMarkdownDocumentTracker {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabGroups(() => this._onDidChange.fire()),
      vscode.window.tabGroups.onDidChangeTabs(() => this._onDidChange.fire())
    );
  }

  async getDocument(): Promise<vscode.TextDocument | undefined> {
    const uri = getTabUri(vscode.window.tabGroups.activeTabGroup?.activeTab?.input);
    if (!uri) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    return document.languageId === "markdown" ? document : undefined;
  }

  /** Info de diagnóstico sobre por qué no se detectó ningún documento Markdown activo. */
  describeActiveTab(): string {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (!activeTab) {
      return "sin pestaña activa en tabGroups";
    }
    const input = activeTab.input;
    const uri = getTabUri(input);
    if (!uri) {
      return `pestaña activa "${activeTab.label}" tiene un tipo de editor no reconocido (${input?.constructor?.name ?? typeof input})`;
    }
    if (input instanceof vscode.TabInputCustom) {
      return `pestaña "${activeTab.label}" es un editor personalizado (viewType=${input.viewType}), uri=${uri.toString()}`;
    }
    return `pestaña activa: ${uri.toString()}`;
  }
}
