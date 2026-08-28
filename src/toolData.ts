import * as path from "path";
import * as vscode from "vscode";
import { extractFrontmatterKeys, extractHeadings, extractTags, HeadingMatch } from "./markdownUtils";
import { TreeNode } from "./treeNode";
import { extractWikilinksDetailed, findNoteFiles, noteNameKey, resolveNoteFile, wikilinkTargetName } from "./wikilinks";

export type ToolId = "backlinks" | "outgoing" | "tags" | "properties" | "outline";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "tif", "tiff", "avif"]);

function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase());
}

/** Envuelve en comillas los valores con espacios, para la sintaxis de búsqueda de Obsidian-like Search. */
function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

export interface ToolResult {
  title: string;
  nodes: TreeNode[];
  emptyMessage?: string;
}

/** Calcula los datos a mostrar en el panel para la herramienta seleccionada. */
export async function computeToolData(
  tool: ToolId,
  activeDocument: vscode.TextDocument | undefined
): Promise<ToolResult> {
  switch (tool) {
    case "backlinks":
      return computeBacklinks(activeDocument);
    case "outgoing":
      return computeOutgoingLinks(activeDocument);
    case "tags":
      return computeTags();
    case "properties":
      return computeProperties();
    case "outline":
      return computeOutline(activeDocument);
  }
}

async function computeBacklinks(activeDocument: vscode.TextDocument | undefined): Promise<ToolResult> {
  const title = "Enlaces entrantes";
  if (!activeDocument) {
    return { title, nodes: [], emptyMessage: "Abre un archivo Markdown para ver sus enlaces entrantes." };
  }

  const targetName = noteNameKey(path.basename(activeDocument.fileName, path.extname(activeDocument.fileName)));
  const candidates = (await findNoteFiles()).filter(
    (note) => note.uri.toString() !== activeDocument.uri.toString()
  );

  const nodes: TreeNode[] = [];
  for (const candidate of candidates) {
    const sourceDocument = await vscode.workspace.openTextDocument(candidate.uri);
    const links = extractWikilinksDetailed(sourceDocument.getText()).filter(
      (link) => noteNameKey(wikilinkTargetName(link.noteName)) === targetName
    );
    if (links.length === 0) {
      continue;
    }

    const firstPosition = sourceDocument.positionAt(links[0].index);
    nodes.push({
      id: candidate.uri.toString(),
      label: vscode.workspace.asRelativePath(candidate.uri),
      description: links.length > 1 ? `${links.length} enlaces` : "1 enlace",
      icon: links.some((link) => link.isEmbed) ? "embed" : "link",
      uri: candidate.uri.toString(),
      line: firstPosition.line,
    });
  }

  return { title, nodes, emptyMessage: nodes.length === 0 ? "No se encontraron enlaces entrantes." : undefined };
}

async function computeOutgoingLinks(activeDocument: vscode.TextDocument | undefined): Promise<ToolResult> {
  const title = "Enlaces salientes";
  if (!activeDocument) {
    return { title, nodes: [], emptyMessage: "Abre un archivo Markdown para ver sus enlaces salientes." };
  }

  const links = extractWikilinksDetailed(activeDocument.getText()).filter(
    (link) => !(link.isEmbed && isImageFilename(link.noteName))
  );
  const nodes: TreeNode[] = [];
  for (const link of links) {
    const note = await resolveNoteFile(link.noteName);
    nodes.push({
      id: `${link.index}`,
      label: link.noteName,
      description: link.isEmbed ? "Transclusión" : "Enlace",
      icon: note ? (link.isEmbed ? "embed" : "link") : "warning",
      uri: note?.uri.toString(),
      line: 0,
      tooltip: note ? vscode.workspace.asRelativePath(note.uri) : "Nota no encontrada en el workspace",
    });
  }

  return {
    title,
    nodes,
    emptyMessage: nodes.length === 0 ? "Este documento no tiene enlaces salientes." : undefined,
  };
}

async function computeTags(): Promise<ToolResult> {
  const title = "Etiquetas";
  const tagCounts = new Map<string, number>();

  for (const note of await findNoteFiles()) {
    const document = await vscode.workspace.openTextDocument(note.uri);
    for (const match of extractTags(document.getText())) {
      const key = match.tag.toLowerCase();
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    }
  }

  const nodes: TreeNode[] = Array.from(tagCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, count]) => ({
      id: tag,
      label: `#${tag}`,
      description: `${count}`,
      icon: "tag" as const,
      searchQuery: `tag:${quoteIfNeeded(tag)}`,
    }));

  return { title, nodes, emptyMessage: nodes.length === 0 ? "No se encontraron etiquetas." : undefined };
}

async function computeProperties(): Promise<ToolResult> {
  const title = "Propiedades";
  const propertyCounts = new Map<string, number>();

  for (const note of await findNoteFiles()) {
    const document = await vscode.workspace.openTextDocument(note.uri);
    for (const key of new Set(extractFrontmatterKeys(document.getText()))) {
      propertyCounts.set(key, (propertyCounts.get(key) ?? 0) + 1);
    }
  }

  const nodes: TreeNode[] = Array.from(propertyCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({
      id: key,
      label: key,
      description: count > 1 ? `${count} veces` : "1 vez",
      icon: "property" as const,
      searchQuery: `[${key}]`,
    }));

  return {
    title,
    nodes,
    emptyMessage: nodes.length === 0 ? "No se encontraron propiedades en ningún frontmatter." : undefined,
  };
}

function headingsToNodes(headings: HeadingMatch[], uri: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: { level: number; node: TreeNode }[] = [];

  for (const heading of headings) {
    const node: TreeNode = {
      id: `h-${heading.line}`,
      label: heading.title,
      description: "#".repeat(heading.level),
      icon: "heading",
      uri,
      line: heading.line,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children!.push(node);
    }
    stack.push({ level: heading.level, node });
  }

  return roots;
}

async function computeOutline(activeDocument: vscode.TextDocument | undefined): Promise<ToolResult> {
  const title = "Esquema";
  if (!activeDocument) {
    return { title, nodes: [], emptyMessage: "Abre un archivo Markdown para ver su esquema." };
  }

  const nodes = headingsToNodes(extractHeadings(activeDocument.getText()), activeDocument.uri.toString());
  return { title, nodes, emptyMessage: nodes.length === 0 ? "Este documento no tiene encabezados." : undefined };
}
