# Workflows

## Open

- **Ways to open a PDF:**
  - **Open PDF…** (⌘O / Ctrl+O), which uses the native dialog;
  - dropping a PDF anywhere on the window;
  - a row in **Recent**;
  - **Try a sample form**, which builds the rental application locally.
- **Unsaved work:** opening another file while work is unexported asks before replacing it.
- **Password-protected files:**
  - FormFlow asks for the password.
  - A wrong password says so and lets you try again.
  - The password is used only to decrypt in memory and is never stored.
- **Files that fail to open:**

  | Problem | Message |
  | --- | --- |
  | Empty file | "The file is empty." |
  | Not a PDF | "This file is not a PDF document." |
  | Damaged PDF | "This PDF is damaged and could not be read." |
  | Larger than 512 MB | Too-large message |

  In every case the current document stays open.
- **Resume:** reopening a file you worked on (matched by content hash, not name)
  offers **Restore** or **Start fresh**.

## Guided filling

**Fill form** in the header (or **Start guided filling** in the properties panel)
walks through every field in reading order.

- **Guided panel:** shows *Field N of M*, the page, the field's label and status,
  and *Possible field* when detection is unsure.
- **Moving through fields:**
  - The current field is scrolled to the centre and highlighted.
  - Text and date fields open for typing straight away.
  - **Enter** saves and moves to the next field; **Shift+Enter** goes back. In a
    multi-line field, use the Next button.
- **Per-field actions:**
  - **Skip:** leave the field for later. Skipped fields show up in the export review.
  - **N/A:** mark the field not applicable. It counts as done.
  - **Today:** fills a date field with today's date, in the format chosen in Settings.
  - **Change type:** from the properties panel, e.g. text → date.
- **Overview:** the field list in the panel and the **Fields** tab in the sidebar.
  Click any field to revisit it.
- **End of the list:** the final review opens.
  - It lists fields that are still empty or skipped, plus possible fields to check.
  - Each one is clickable.
  - Export from here, or keep editing.

## Free annotation

| Tool | Key | Notes |
| --- | --- | --- |
| Select | V | Click to select; ⇧-click to add; drag to move; handles to resize; arrows nudge (⇧ = 10 pt) |
| Text | T | Click to place, type, click away to finish. Font, size, colour, bold, alignment in the panel |
| Check / Cross | K / X | Click to stamp a mark |
| Date | D | Places today's date in the chosen format |
| Signature | S | Opens the signature dialog, then places at the click point |
| Draw | P | Freehand ink, smoothed |
| Highlight | H | Drag a translucent rectangle |

Other shortcuts:

| Shortcut | Action |
| --- | --- |
| ⌘Z, ⇧⌘Z / ⌘Y | Undo, redo (a drag or resize is one step) |
| ⌘D | Duplicate |
| ⌘A | Select all on the page |
| Delete | Remove |
| ⌘= / ⌘- | Zoom in / out |
| ⌘0 | 100% |
| ⌘9 | Fit page |
| ⌘8 | Fit width |
| PageUp / PageDown | Move between pages |
| ? | All shortcuts |

On Windows, use Ctrl in place of ⌘.

## Signatures

- **Create:** draw (mouse, trackpad or pen), type (three script styles) or import
  an image (PNG or JPEG; white backgrounds are removed). Ink colour is selectable.
- **Place:** signatures keep their aspect ratio when resized.
- **Saved signatures:** are kept only when you tick **Remember on this device**. They
  can be deleted individually, and **Settings → Clear local data** removes them all.
- **Not a digital signature:** this is a visual signature, *not* a cryptographic one.
  The exported file is not certified.

## Save progress vs Export

- **Progress** is saved automatically on this device (the header shows *Saved on
  this device*). There is nothing to "save"; ⌘S explains this.
- **Export PDF** (⌘E) writes a new file, by default `name-filled.pdf`:
  - The original is never overwritten. The desktop app refuses to save over the
    source file, even under another name.
  - Your additions are drawn into the page content (flattened). Native form fields
    you filled are replaced by their values. Untouched native fields stay interactive.
  - Before saving, the result is re-opened with pdf.js and its page count checked;
    a file that fails this check is not written.
  - Encrypted PDFs can't be modified in place. FormFlow offers a flattened copy in
    which each original page becomes an image with your additions on top, and says
    so before doing it.
