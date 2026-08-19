# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is **two independent, single-file, static HTML applications** for Tecnodrill (an industrial equipment company). There is no build system, no package manager, no server-side code, and no test suite — each `.html` file is a complete app (markup, CSS, and JS all inline) that runs by opening it directly in a browser.

- `index.html` — **Planos de Ação 5W2H**: a project/action-tracking tool (5W2H methodology) backed by Firebase Realtime Database for live multi-user sync.
- `custo-producao.html` — **Custo de Produção**: a client-side cost-analysis dashboard that ingests an Excel export from the SIGER ERP and computes production cost breakdowns (labor, materials, third-party services, overruns).

The two files share no code and are not linked to each other. UI text, variable names, and commit messages are in Portuguese (pt-BR); keep new code consistent with that.

## Running / developing

There is nothing to install or build.

- Open the file directly in a browser (`file://...`), or serve the directory statically (e.g. `python3 -m http.server`) if `file://` restrictions cause issues (CORS on the Firebase SDK, etc.).
- No linter, formatter, or test runner is configured. Validate changes manually in the browser — there's no automated check to run.
- Both files are large (1,400+ / 1,900+ lines) single files with `<style>` and `<script>` blocks inline at the bottom/top of the HTML. When editing, use targeted greps/reads for the relevant function rather than reading the whole file.

## `index.html` — Planos de Ação 5W2H

Vanilla JS SPA, no framework. All state lives in one `state` object and is mirrored to/from **Firebase Realtime Database**.

- **Firebase config** (`firebaseConfig`, project `wh2-tecnodrill`) is hardcoded inline — this is expected for a client-only RTDB app, not a bug to "fix" by hiding it.
- **Data model / RTDB paths:**
  - `projects/{projectId}` — project metadata (`name`, `desc`, `client`, `deadline`, `emoji`, `order`, `createdAt`)
  - `projects/{projectId}/cards/{cardId}` — 5W2H action items (`title`/`aTitle` "O quê?", `why`, `who`, `when`, `where`, priority, status, `pends` pending-items list, `open`)
  - `projects/{projectId}/photos` — array of `{url, caption}` (images hosted externally on imgbb, only the direct link is stored)
- **`save(path, val)`** does `db.ref(path).set(...)`, **`update(path, val)`** does `db.ref(path).update(...)`; both call `markSaving()` first, which flips the top-bar sync indicator (`#syncDot`/`#syncText`) to "Salvando..." then back to "Sincronizado em tempo real" — always route writes through these two helpers rather than calling `db.ref()` directly, so the sync indicator stays accurate.
- Realtime listeners: `db.ref('projects').on('value', ...)` feeds the dashboard; per-project listeners (`state.cardsRef`, `state.photosRef`, `state.projectRef`) are attached in `openProject()`-style code and torn down in `detachListeners()` when navigating away — always pair a new listener attach with `detachListeners()` on exit to avoid leaks/stale UI.
- **Auth** is a single hardcoded password (`checkLogin()`, literal string in source) gating access via `sessionStorage['td-auth']`. This is a UI deterrent only, not real security — the password and all data are visible to anyone who opens the file/devtools.
- **Theme** ("dark"/"light") persists in `localStorage['td-theme']`, applied via `applyTheme()` by toggling a class on `<body>`; CSS variables for both themes are defined in `:root` and `body.light` in the `<style>` block.
- Two screens toggled via `hidden`: `#dashboardScreen` (project grid, search, stats) and `#projectScreen` (action list, filters, photo gallery). Action filtering is client-side via `state.activeFilter` and `render(filter)`.
- Emoji picker (`EMOJIS` catalog with Portuguese search keywords) is used for project icons; see `buildEmojiPicker` / `openEmojiPopover`.

## `custo-producao.html` — Custo de Produção

Also vanilla JS, no framework. Depends on two CDN libraries loaded via `<script src>`: **SheetJS (`xlsx`)** for reading the uploaded workbook and **Chart.js** for charts. There is no live backend — the user uploads an `.xlsx` export each session and everything is computed client-side.

- **Input contract:** `handleFile()` expects an Excel workbook with specific sheet names exported from SIGER:
  - `ITENS OP CUSTO` (required — throws if missing/empty) — items/BOM cost lines per OP (production order)
  - `ACOMP PROD` — labor/production tracking entries (start/end times → hours worked)
  - `RET SERVC EXT` — third-party service returns
  - Column matching is header-name-based and tolerant of accents/variants: `normCol()` strips accents/punctuation, `buildIdx()`/`findI()` resolve a column index from a list of acceptable header aliases. When a sheet's real-world column headers change, fix the alias list passed to `findI(...)` in the relevant `parse*` function rather than hardcoding column indices.
  - `parseItens`, `parseAcomp`, `parseTerc` turn raw rows into arrays of typed row objects (`ITENS`, `ACOMP`, `TERC` globals); `buildOpsList()` derives the list of distinct OPs (`OPS`).
- **Cost aggregation invariant:** an OP's material tree contains sub-assemblies that are *also* listed as their own top-level position later in the same OP. `subassemblyCodes(op)` identifies those parent codes so `materialTotal()`/`materialTree()`/`positionsIndex()` can exclude them where they're consumed, counting their cost only once (at their own leaf position) — do not "simplify" this filtering without re-reading the comments around `materialTree()`/`positionsIndex()`, it exists specifically to prevent double-counting.
- **Optional standard-BOM comparison:** `BOM_PADRAO` (loaded separately from a printed "Listagem de Formulações" SIGER report, not part of the main cost export) enables comparing actual vs. standard quantities/costs; it's optional and much of the app works without it.
- **User-editable overrides**, all persisted to `localStorage` (not Firebase — this app has no backend), separate keys per concern:
  - `RATE_STORAGE_KEY` (`tecnodrill_custo_rates_v1`) — labor rate overrides, via `loadRates()`/`saveRates()`
  - `EXCEDENTE_STORAGE_KEY` — approved-overrun flags, via `loadExcedenteAprovado()`/`saveExcedenteAprovado()`
  - `EXTRA_APONT_STORAGE_KEY` — manually added extra time entries, via `loadExtraApontamento()`/`saveExtraApontamento()`
- **Navigation:** left sidebar tabs (`.side-nav a[data-tab]`) — Visão Geral, Mão de Obra, Matéria-prima, Terceiros, Excedente — switched client-side; see the tab-click handler near the bottom of the file and `renderTabs()`.
- Supports comparing two OPs side by side (`opA`/`opB`, `currentView`), picked via the `.op-picker` search/autocomplete UI.
- `exportPdf()` produces a printable/exportable report of the current view.
