import * as vscode from "vscode";
import { ActiveMarkdownDocumentTracker } from "../activeMarkdownDocument";
import { log } from "../log";
import { computeToolData, ToolId } from "../toolData";

interface WebviewMessage {
  type: "ready" | "selectTool" | "open" | "search";
  tool?: ToolId;
  uri?: string;
  line?: number;
  query?: string;
}

const DEFAULT_TOOL: ToolId = "backlinks";
const TOOLS_NEEDING_ACTIVE_DOCUMENT: ToolId[] = ["backlinks", "outgoing", "outline"];

/**
 * Panel único con una barra de herramientas horizontal (Enlaces entrantes,
 * Enlaces salientes, Etiquetas, Propiedades, Esquema) que ocupa el 100% del
 * espacio vertical restante con el contenido de la herramienta seleccionada.
 */
export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private selectedTool: ToolId = DEFAULT_TOOL;
  /** Se incrementa en cada `postData()`; permite descartar respuestas de una petición anterior que resuelve tarde (p.ej. al cambiar de pestaña rápido). */
  private requestSeq = 0;

  constructor(private readonly tracker: ActiveMarkdownDocumentTracker, context: vscode.ExtensionContext) {
    context.subscriptions.push(
      tracker.onDidChange(() => this.refresh()),
      vscode.workspace.onDidSaveTextDocument(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(() => {
        if (this.selectedTool === "outline") {
          this.refresh();
        }
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getHtml();
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });
  }

  refresh(): void {
    void this.postData();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postData();
        break;
      case "selectTool":
        if (message.tool) {
          this.selectedTool = message.tool;
          await this.postData();
        }
        break;
      case "open":
        if (message.uri) {
          await this.openNote(vscode.Uri.parse(message.uri), message.line ?? 0);
        }
        break;
      case "search":
        if (message.query) {
          await this.runSearch(message.query);
        }
        break;
    }
  }

  /**
   * Abre `uri` en la línea (0-based) indicada. Las notas se muestran con el
   * editor personalizado `vaultTool.markdownEditor` de la extensión hermana
   * `obsidianlike` (ver activeMarkdownDocument.ts), cuyo webview ignora la
   * opción `selection` de `vscode.open` (esa opción solo la aplica el editor
   * de texto plano). Por eso, si esa extensión está instalada, delegamos el
   * scroll en su comando `vaultTool.openNoteAtLine(uri, line)` — soft
   * dependency, comprobada aquí con `getCommands()` porque `obsidianlike` ya
   * está activa siempre que se use este panel (es quien muestra la nota
   * actual) — y si no está instalada caemos a `vscode.open`, que sí funciona
   * para el editor de texto plano por defecto. (`runSearch()` no puede asumir
   * lo mismo de `obsidianlike_search`, ver comentario allí.)
   */
  private async openNote(uri: vscode.Uri, line: number): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes("vaultTool.openNoteAtLine")) {
      await vscode.commands.executeCommand("vaultTool.openNoteAtLine", uri, line);
      return;
    }
    const position = new vscode.Position(line, 0);
    await vscode.commands.executeCommand("vscode.open", uri, {
      selection: new vscode.Range(position, position),
    });
  }

  private async runSearch(query: string): Promise<void> {
    // No se usa `getCommands()` para comprobar de antemano si el comando existe:
    // una extensión contribuida pero aún no activada (p.ej. porque su vista
    // nunca se ha abierto) puede no aparecer todavía en `getCommands()` aunque
    // `executeCommand` sí la active correctamente bajo demanda — esa comprobación
    // previa producía falsos negativos ("no está instalada") con la extensión
    // instalada y activa. En su lugar se intenta ejecutar directamente y solo se
    // avisa si de verdad falla.
    try {
      await vscode.commands.executeCommand("obsidianlikeSearch.searchFor", query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`runSearch: ERROR ejecutando obsidianlikeSearch.searchFor: ${message}`);
      if (/command.*not found/i.test(message)) {
        void vscode.window.showWarningMessage(
          "La extensión Obsidian-like Search no está instalada; no se puede buscar."
        );
      } else {
        void vscode.window.showErrorMessage(
          'Error al buscar en Obsidian-like Search. Revisa "View > Output > Obsidian-like Links".'
        );
      }
    }
  }

  private async postData(): Promise<void> {
    if (!this.view) {
      return;
    }
    const requestId = ++this.requestSeq;
    const selectedTool = this.selectedTool;
    log(`postData #${requestId}: tool=${selectedTool}`);
    try {
      const activeDocument = await this.tracker.getDocument();
      const result = await computeToolData(selectedTool, activeDocument);
      if (requestId !== this.requestSeq) {
        // Llegó una petición más reciente (p.ej. cambio de pestaña) mientras esta calculaba; descartar para no pisar datos actuales con datos obsoletos.
        log(`postData #${requestId}: descartada (obsoleta, ahora va #${this.requestSeq})`);
        return;
      }
      if (!activeDocument && TOOLS_NEEDING_ACTIVE_DOCUMENT.includes(selectedTool)) {
        result.emptyMessage = `${result.emptyMessage} [diagnóstico: ${this.tracker.describeActiveTab()}]`;
      }
      const labels = result.nodes.map((n) => n.label).join(" | ");
      const textPreview = activeDocument?.getText().slice(0, 40).replace(/\n/g, "\\n");
      log(
        `postData #${requestId}: enviando ${result.nodes.length} nodos [${labels}] ` +
          `(doc=${activeDocument?.uri.toString() ?? "ninguno"}, textLen=${activeDocument?.getText().length ?? "-"}, textStart="${textPreview}")`
      );
      void this.view.webview.postMessage({ type: "data", tool: selectedTool, ...result });
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      log(`postData #${requestId}: ERROR calculando "${selectedTool}": ${message}`);
      if (requestId === this.requestSeq) {
        void this.view.webview.postMessage({
          type: "data",
          tool: selectedTool,
          title: selectedTool,
          nodes: [],
          emptyMessage: `Error interno calculando esta herramienta. Revisa "View > Output > Obsidian-like Links". [diagnóstico: ${this.tracker.describeActiveTab()}]`,
        });
      }
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function getHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Obsidian-like Links</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  .toolbar {
    flex: 0 0 auto;
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .toolbar button {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7px 0;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
  }
  .toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .toolbar button.active {
    border-bottom-color: var(--vscode-focusBorder);
    color: var(--vscode-foreground);
  }
  .toolbar svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .panel-title {
    flex: 0 0 auto;
    padding: 6px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }
  .content { flex: 1 1 auto; overflow-y: auto; padding-bottom: 8px; }
  .empty { padding: 10px; opacity: 0.7; font-style: italic; }
  ul { list-style: none; margin: 0; padding: 0; }
  .row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .twisty { flex: 0 0 12px; width: 12px; height: 12px; display: flex; align-items: center; justify-content: center; opacity: 0.75; }
  .twisty svg { width: 10px; height: 10px; fill: currentColor; }
  .row-icon { flex: 0 0 16px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; opacity: 0.85; }
  .row-icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
  .label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
  .desc { flex: 0 0 auto; font-size: 11px; opacity: 0.6; padding-left: 6px; }
  .children { padding-left: 16px; }
  .children.collapsed { display: none; }
</style>
</head>
<body>
  <div class="toolbar" id="toolbar"></div>
  <div class="panel-title" id="panel-title"></div>
  <div class="content" id="content"></div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();

      const ICONS = {
        backlinks: '<path d="M9 15L15 9"/><path d="M11 6l1.5-1.5a4 4 0 0 1 5.66 5.66L16.5 11.66"/><path d="M13 18l-1.5 1.5a4 4 0 0 1-5.66-5.66L7.34 12.34"/>',
        outgoing: '<path d="M7 17L17 7"/><path d="M9 7h8v8"/>',
        tags: '<path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
        properties: '<path d="M6 4h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V4z"/><path d="M9 14v2a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-2"/>',
        outline: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
        link: '<path d="M9 15L15 9"/><path d="M11 6l1.5-1.5a4 4 0 0 1 5.66 5.66L16.5 11.66"/><path d="M13 18l-1.5 1.5a4 4 0 0 1-5.66-5.66L7.34 12.34"/>',
        embed: '<path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M14 4h6v6"/><path d="M20 4l-9 9"/>',
        warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
        tag: '<path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
        property: '<path d="M6 4h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V4z"/><path d="M9 14v2a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-2"/>',
        heading: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
      };

      const TOOLS = [
        { id: "backlinks", label: "Enlaces entrantes" },
        { id: "outgoing", label: "Enlaces salientes" },
        { id: "tags", label: "Etiquetas" },
        { id: "properties", label: "Propiedades" },
        { id: "outline", label: "Esquema" },
      ];

      const toolbar = document.getElementById("toolbar");
      const panelTitle = document.getElementById("panel-title");
      const content = document.getElementById("content");
      const collapsed = new Set();
      let currentTool = "backlinks";

      function svg(name) {
        return '<svg viewBox="0 0 24 24">' + (ICONS[name] || "") + "</svg>";
      }

      TOOLS.forEach((tool) => {
        const button = document.createElement("button");
        button.title = tool.label;
        button.dataset.tool = tool.id;
        button.innerHTML = svg(tool.id);
        button.addEventListener("click", () => {
          currentTool = tool.id;
          updateActiveButton();
          vscode.postMessage({ type: "selectTool", tool: tool.id });
        });
        toolbar.appendChild(button);
      });

      function updateActiveButton() {
        Array.from(toolbar.children).forEach((button) => {
          button.classList.toggle("active", button.dataset.tool === currentTool);
        });
      }

      function renderNodes(nodes, container) {
        const ul = document.createElement("ul");
        nodes.forEach((node) => ul.appendChild(renderNode(node)));
        container.appendChild(ul);
      }

      function renderNode(node) {
        const li = document.createElement("li");
        const row = document.createElement("div");
        row.className = "row";
        row.title = node.tooltip || node.label;

        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const twisty = document.createElement("span");
        twisty.className = "twisty";
        if (hasChildren) {
          twisty.innerHTML = collapsed.has(node.id)
            ? '<svg viewBox="0 0 10 10"><path d="M2 0l6 5-6 5z"/></svg>'
            : '<svg viewBox="0 0 10 10"><path d="M0 2l5 6 5-6z"/></svg>';
          twisty.addEventListener("click", (event) => {
            event.stopPropagation();
            if (collapsed.has(node.id)) {
              collapsed.delete(node.id);
            } else {
              collapsed.add(node.id);
            }
            renderCurrentData();
          });
        }
        row.appendChild(twisty);

        if (node.icon) {
          const iconEl = document.createElement("span");
          iconEl.className = "row-icon";
          iconEl.innerHTML = svg(node.icon);
          row.appendChild(iconEl);
        }

        const label = document.createElement("span");
        label.className = "label";
        label.textContent = node.label;
        row.appendChild(label);

        if (node.description) {
          const desc = document.createElement("span");
          desc.className = "desc";
          desc.textContent = node.description;
          row.appendChild(desc);
        }

        row.addEventListener("click", () => {
          if (node.uri) {
            vscode.postMessage({ type: "open", uri: node.uri, line: node.line || 0 });
          } else if (node.searchQuery) {
            vscode.postMessage({ type: "search", query: node.searchQuery });
          }
        });

        li.appendChild(row);

        if (hasChildren) {
          const childrenEl = document.createElement("div");
          childrenEl.className = "children" + (collapsed.has(node.id) ? " collapsed" : "");
          renderNodes(node.children, childrenEl);
          li.appendChild(childrenEl);
        }

        return li;
      }

      let lastData = null;

      function renderCurrentData() {
        if (!lastData) {
          return;
        }
        panelTitle.textContent = lastData.title;
        content.innerHTML = "";
        if (lastData.nodes.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = lastData.emptyMessage || "";
          content.appendChild(empty);
          return;
        }
        renderNodes(lastData.nodes, content);
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "data") {
          currentTool = message.tool;
          updateActiveButton();
          lastData = message;
          renderCurrentData();
        }
      });

      updateActiveButton();
      vscode.postMessage({ type: "ready" });
    })();
  </script>
</body>
</html>`;
}
