export type TreeNodeIcon = "link" | "embed" | "warning" | "tag" | "property" | "heading";

/** Nodo serializable enviado al webview del panel (ver views/panelViewProvider.ts). */
export interface TreeNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: TreeNodeIcon;
  /** Uri.toString() del archivo a abrir al hacer click, si el nodo es navegable. */
  uri?: string;
  /** Línea (0-based) a la que saltar dentro del archivo. */
  line?: number;
  /**
   * Si está definido (y no hay `uri`), hacer click en el nodo no abre un
   * archivo: ejecuta una búsqueda con esta query en la extensión
   * Obsidian-like Search (ver views/panelViewProvider.ts, mensaje "search").
   */
  searchQuery?: string;
  children?: TreeNode[];
}
