# the-board

Live board with one editor and any number of synced viewers. No dependencies: Node 18+.

```
npm start            # PORT=4321 by default
```

- Editor: http://localhost:4321/editor
- Viewer: http://localhost:4321/viewer (add `?transparent` for an OBS / browser-source overlay)

Both pages show the same board, anchored at the **bottom-left corner**: an object 100px from
the left and 50px from the bottom sits there on every screen, whatever the window size.
The editor draws a dashed outline for each connected viewer's viewport.

State (objects and uploaded images) lives in server memory, so it survives page reloads
but not a server restart.

## Editor

| Action | How |
| --- | --- |
| Add image / GIF | Ctrl+V, drag-and-drop, or **＋ Image** |
| Add text | **＋ Text** or `T`; pasting plain text works too |
| Select / move | click, drag |
| Resize | corner handles (keeps aspect; hold Shift for free resize on images) |
| Rotate | round handle on top (Shift snaps to 15°) |
| Layer forward / backward | PageUp / PageDown, or `]` / `[` |
| Layer to front / back | Home / End, or Ctrl+`]` / Ctrl+`[` (Shift works too) |
| Copy / paste / duplicate | Ctrl+C / Ctrl+V / Ctrl+D |
| Delete | Del / Backspace |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) |
| Nudge | arrow keys (Shift = 10px) |
| Hide UI | `H` (or ⋯ → Hide UI) |

GIFs stay animated. When a browser's "Copy image" puts a static PNG on the clipboard, the
editor grabs the original URL from the clipboard HTML and has the server download the real
file instead.

## Export / import

Everything lives in the **⋯** menu:

- **Export PNG** — a snapshot of the board at the editor's size or at any connected viewer's
  size. Animated GIFs come out as their first frame.
- **Export board file** — a `.json` with the images embedded. Re-import it with
  **Import board file…** (or just drop it on the board) to restore the board, even after a
  server restart.
