# Obsidian-like Links

Extensión de VS Code que trae a Markdown algunas funcionalidades de [Obsidian](https://obsidian.md) basadas en wikilinks (`[[nota]]`).

## Funcionalidades

- **Autocompletado de wikilinks**: al escribir `[[` se sugieren las notas del workspace.
- **Navegación (Ctrl+Click / F12)**: salta desde un `[[wikilink]]` al archivo correspondiente.
- **Vista previa al pasar el cursor (hover)**: muestra las primeras líneas de la nota enlazada.
- **Panel "Obsidian-like Links"** (icono en la barra de actividad, se puede arrastrar a la barra lateral secundaria): un único panel con una barra de iconos horizontal arriba para cambiar de herramienta, y el contenido de la herramienta seleccionada ocupando el 100% del espacio vertical restante (igual que el panel de Obsidian):
  - **Enlaces entrantes**: páginas que enlazan al documento con el foco actual.
  - **Enlaces salientes**: páginas enlazadas desde el documento actual, incluyendo transclusiones (`![[nota]]`).
  - **Etiquetas**: lista de todos los `#tags` utilizados en toda la bóveda (workspace), con los archivos donde aparece cada una.
  - **Propiedades**: lista alfabética de las propiedades usadas en los frontmatters de la bóveda, con el número de veces que se ha usado cada una.
  - **Esquema**: encabezados (`#`, `##`, `###`...) del documento activo, en orden de aparición y anidados según su nivel.
- **Comando "Obsidian-like Links: Insertar enlace"**: inserta un `[[wikilink]]` eligiendo la nota desde un selector.

## Estructura del proyecto

```
src/
  extension.ts               Punto de entrada: registra providers, panel y comandos
  activeMarkdownDocument.ts   Rastrea el último documento Markdown con foco (ver nota abajo)
  wikilinks.ts                Utilidades de wikilinks (regex, búsqueda/resolución de notas)
  markdownUtils.ts            Utilidades de Markdown (tags, frontmatter, encabezados)
  toolData.ts                 Calcula los datos de cada herramienta (backlinks, outgoing, tags, properties, outline)
  treeNode.ts                 Tipo de nodo serializable que se envía al webview
  providers/
    completionProvider.ts     Autocompletado de [[wikilinks]]
    definitionProvider.ts     Ir a definición
    hoverProvider.ts           Vista previa al hacer hover
  views/
    panelViewProvider.ts       Panel único (WebviewView): barra de iconos + contenido a pantalla completa
media/
  icon.svg                     Icono del contenedor en la barra de actividad
```

> **Nota**: `vscode.window.activeTextEditor` pasa a `undefined` en cuanto el foco sale de un editor de texto (p. ej. al hacer clic en este mismo panel), así que las herramientas que dependen del "documento activo" no lo leen directamente — usan `ActiveMarkdownDocumentTracker`, que recuerda el último documento Markdown con foco y lo ignora cuando `activeTextEditor` se vuelve `undefined`. Además, como los eventos de VS Code sobre la pestaña activa no siempre son fiables en timing con editores personalizados de otras extensiones (p. ej. el de la extensión hermana `obsidianlike`), el tracker no confía ciegamente en ellos: combina un pequeño retardo de "asentado" con un sondeo periódico como red de seguridad, para que el panel siempre acabe reflejando la pestaña realmente activa aunque el evento llegue tarde o de forma inconsistente.

## Desarrollo

Requisitos: Node.js 20+ y VS Code.

```bash
npm install
npm run compile   # o npm run watch
```

Para probar la extensión, abre este proyecto en VS Code y pulsa `F5` (lanza una nueva ventana "Extension Development Host" con la extensión cargada). Abre una carpeta con archivos `.md` que contengan `[[wikilinks]]` para ver las funcionalidades en acción.

## Configuración

- `obsidianlikeLinks.noteExtensions` (array, por defecto `["md"]`): extensiones de archivo consideradas notas al resolver wikilinks.

## Empaquetar e instalar

```bash
npm run package    # genera obsidianlike-links-<version>.vsix con vsce
```

Este proyecto es parte del monorepo de extensiones "Obsidian like"; `../obsidianlike/make.bat` compila, desinstala e instala todas ellas (incluida esta) en el perfil de VS Code "Obsidian like".

## Estado

Esqueleto inicial en desarrollo. Próxima funcionalidad candidata: menciones sin enlazar (unlinked mentions).

Corregido (2026-07-26): el panel a veces mostraba enlaces entrantes/salientes del documento equivocado al cambiar de pestaña rápido — condición de carrera al procesar las respuestas asíncronas, combinada con eventos de cambio de pestaña poco fiables en timing con el editor personalizado de la extensión hermana `obsidianlike` (que a su vez tenía un bug propio, también corregido, de autoguardado espurio al cambiar de pestaña sin editar nada). Ver detalle técnico en `CLAUDE.md`.

Corregido (2026-07-30): al pulsar una cabecera del Esquema no se hacía scroll hasta su posición en el documento. Ver detalle técnico en `CLAUDE.md`.

Corregido (2026-08-02): en el panel de Etiquetas, (1) pulsar una etiqueta podía mostrar un falso aviso de que Obsidian-like Search no estaba instalada; (2) las etiquetas con acentos se truncaban (`#documentación` → `#documentaci`); (3) los códigos de color hex del highlight de `obsidianlike` (`background-color:#e3ff00;`) se listaban como si fueran etiquetas. Ver detalle técnico en `CLAUDE.md`.

Corregido (2026-08-28): un wikilink con directorio (`[[carpeta/nota]]`, y también `[[carpeta/nota.md]]`) no se contabilizaba como enlace entrante, y tampoco resolvía para navegación, hover ni Enlaces salientes. Ahora el destino del wikilink se normaliza a su nombre de nota (se descarta el directorio y una extensión de nota final) antes de resolver o comparar. Ver detalle técnico en `CLAUDE.md`.

Corregido (2026-08-28): en una nota con acento y emoji en el nombre (p. ej. `👶 José Javier Montes Romero (JJ).md`), Enlaces entrantes solo mostraba 1 de decenas de enlaces reales. Causa: dos nombres visualmente idénticos pueden diferir en bytes — forma de normalización Unicode (NFD vs. NFC, según el nombre venga de macOS o de un wikilink tecleado), un selector de variación invisible tras el emoji, o un espacio duro `U+00A0` en vez de espacio normal. Ahora los nombres de nota se comparan mediante una clave canónica (`noteNameKey`) que normaliza a NFC, descarta esos caracteres invisibles y unifica los espacios. Ver detalle técnico en `CLAUDE.md`.
