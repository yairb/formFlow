# Field detection

Detection runs locally in the WebView when a PDF opens (`src/detect`). It never
sends anything anywhere and does no OCR.

## Layers

1. **Native AcroForm** (`acroform.ts`). Widgets read through pdf.js become fields
   with confidence 1 and source `acroform`. Read-only fields are kept but not
   editable. Their values are written back on export by replacing the field with
   its static appearance plus FormFlow's own text, which makes Unicode/RTL values
   render correctly regardless of the form's fonts.
2. **Text layout** (`textStage.ts`). Text runs are grouped into phrases.
   - Underscore blanks (`Name: ________`) give 0.8 confidence, or 0.6 without a label.
   - Wide space gaps after a colon label give 0.4. This is a weak signal, because a
     lot of printed text ends in a colon.
   - RTL pages put labels on the right of the blank.
3. **Vector graphics** (`visualStage.ts`). The operator list yields lines and rectangles:
   - Fill lines, labelled by the nearest text to the left, right or below.
   - Check squares and radio circles.
   - Boxed inputs.
   - Comb boxes.
   - Table cells under a header row.

   Confidence depends on the label's position and strength. Long rules spanning the
   page are kept only at very low confidence (≤ 0.2) so they don't become fields.
4. **Merge** (`merge.ts`).
   - Candidates covered by a native field are dropped.
   - Overlapping candidates from different layers are merged, and agreement adds +0.05.
   - Kind is classified from geometry and the label lexicon: text, multiline, checkbox, radio, date or signature.
   - Fields are ordered for guided filling in reading order, with right-to-left pages
     read right to left.

The lexicon (`lexicon.ts`) covers English, Hebrew, Spanish, French, German and
Arabic, and is intentionally small.

## How results are presented

Every field carries `source` (acroform / text / visual), `confidence` and a review
status.

- Suggestions at **≥ 0.3** are shown.
- Those below **0.6** are marked **Possible field**:
  - in the guided panel and the field list;
  - in the export review under "Possible fields to check".

The user can accept or reject a suggestion, change its kind, or mark it N/A. On
scanned (image-only) pages detection reports "scanned" instead of guessing.

## Measured accuracy

`npm run detect:eval` scores detection against the generated fixtures in
`tests/fixtures/forms.ts`, each with a ground-truth file. Matching is one to one, on the same page:

- **Check squares and radios:** centres within 6 pt.
- **Text areas:** horizontal overlap ≥ 60%, and baselines within 10 pt or IoU ≥ 0.4.

Native AcroForm widgets are read, not detected, so they are left out of the score.
A detection that duplicates one counts as a false positive.

`tests/detection/detection-eval.test.ts` enforces floors so regressions fail CI:

- precision ≥ 97%;
- recall ≥ 97% at ≥ 0.3 and ≥ 95% at ≥ 0.6;
- kind accuracy ≥ 95%;
- zero errors on the negatives.

The fixtures are:

- rental application (54 fields, 2 pages);
- Hebrew membership form (RTL, 12);
- underscore-style volunteer form (12);
- mixed AcroForm and flat form (3);
- an invoice and a business letter, both negatives with 0 fields;
- a scanned page (0 fields, must be flagged);
- a stress layout (7 fields): dot leaders, comb boxes, distant labels, a dashed rule
  and a rotated page.

Result on 2026-10-13:

| Cut-off | Precision | Recall | Kind accuracy |
| --- | --- | --- | --- |
| ≥ 0.3 (shown) | 100.0% (88/88) | 100.0% (88/88) | 97.7% (86/88) |
| ≥ 0.6 (not flagged) | 100.0% (87/87) | 98.9% (87/88) | 98.9% (86/87) |

**These numbers are optimistic.** The fixtures were written alongside the
detector, so they show that the targeted layouts work. They don't predict accuracy
on arbitrary real-world forms.

The stress-layout fixture was first scored before the detector was tuned for it:

| Cut-off | Detected | Correct | False | Missed |
| --- | --- | --- | --- | --- |
| ≥ 0.3 | 11 | 4 | 7 | 3 of 7 |
| ≥ 0.6 | 2 | 2 | 0 | 5 of 7 |

That is a fairer indication of what an unfamiliar layout looks like. It is why
low-confidence results are labelled as suggestions and the review step exists.

## Known limitations

- **No OCR.** Scanned forms get no suggestions. Users place text with the Text
  tool, which works on any page.
- Colon-plus-whitespace labels are a weak signal. On dense forms they are often
  missed (below 0.3) or flagged as possible fields.
- Labels are only looked up in the immediate neighbourhood, so a label far from
  its field may be lost.
- The lexicon is small. Unknown vocabulary still yields text fields, but the kind
  may be wrong; it can be changed in one click.
- Forms whose fields are drawn as images (rather than vectors or text) are treated
  like scans.
- XFA-only forms have no AcroForm widgets to read. On export the XFA packet is
  removed, with a warning, so viewers show the flattened result.
