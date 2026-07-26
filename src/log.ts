import * as vscode from "vscode";

/**
 * Canal de salida compartido para diagnóstico. Antes, errores dentro de `postData()`
 * (llamado vía `void this.postData()` sin `.catch`) se perdían como promise rejections
 * silenciosas — el panel se quedaba con los últimos datos válidos sin ningún indicio
 * de que algo había fallado. Ver View > Output > "Obsidian-like Links".
 */
export const outputChannel = vscode.window.createOutputChannel("Obsidian-like Links");

export function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}
