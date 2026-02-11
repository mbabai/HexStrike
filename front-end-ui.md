# Front-End UI Guidelines

This document defines the single source of truth for HexStrike's browser UI styling. Follow these rules for any HTML, CSS, or front-end UI work.

## Core palette and typography
- Use the CSS custom properties defined in `public/theme.css` for all colors, radii, shadows, and fonts. Do **not** duplicate hex values elsewhere; extend variables only when necessary.
- Timeline action flashes read from `--color-action-attack`, `--color-action-move`, `--color-action-jump`, and `--color-action-block`.
- Headlines use the `var(--font-heading)` stack and body text uses `var(--font-body)`.
- Default text color is `var(--color-text)` with `var(--color-subtle)` for helper copy.
- Queueing states use the lavender palette (`--color-queue-lavender*`) so the Find Game button reads as a distinct state without diverging from the theme.

## Components and layout
- Panels: use the `.panel` class for framed sections. Keep rounded corners at `var(--radius-panel)` and border color `var(--color-panel-border)` with the subtle inner outline.
- Buttons: start from `.btn`; apply `.btn-primary` for golden calls-to-action, `.btn-queueing` for active queue/search state, and `.btn-ghost` for secondary/dismissive actions. Avoid inline styles; compose classes.
- Pills and groups: use `.pill-group` for horizontal stacks; prefer `.status-pill` for status text.
- Grids: prefer `.grid-layout` for responsive card grids and `.field-row` for stacked form controls.
- Tables: wrap data tables in `.table-wrapper` and apply `.data-table` for striped rows and header styling.
- Modals: use `.modal-overlay` with a `.panel` inner container (e.g. `.deck-preview`, `.deck-builder`, `.deck-name`) to keep overlays consistent with the lobby theme.
- Deck library: use `.menu-decks` with `.deck-grid` and `.deck-card` for portrait-based deck browsing.
- Deck builder: use `.deck-builder` with `.deck-builder-layout` for the left library / right deck split, `.deck-library-scroll` for the card-grid scroller, and a single `.deck-stack` inside `.deck-stack-scroll` (movement cards first, then ability cards) with `.deck-stack-hitbox` for top-sliver hover/click behavior; use `.deck-character-summary` + `.deck-character-modal` for character selection.
- Game surface: use `.game-area` as the full-page canvas host, `.game-frame` as the clipping wrapper, and `.game-canvas` for the drawing surface; hex grid colors should read from `--color-game-surface`, `--color-hex-fill`, and `--color-hex-stroke`.
- Rotation wheel: use `.rotation-selector` with `.rotation-wheel` for the donut control; `.rotation-wedge` handles segments, `.is-selected` applies the gold highlight, and `.is-disabled` greys out illegal rotations.
- Action HUD: use `.action-hud` for the bottom-center action layout, `.action-hand` for card columns, `.action-card` for movement/ability cards, `.action-slot`/`.action-slot-drop` for active/passive slots, and `.action-hud.is-locked` for locked-in styling.
- Discard prompt: use `.discard-modal` as a compact, centered prompt over the game area; discard selection reuses in-hand `.action-card` elements with `.is-discard-pending` (pulsing) and `.is-discard-selected` (greyed) states instead of rendering a separate hand.
- Draw prompt: use `.draw-modal` (same sizing as `.discard-modal`) for movement-draw selection; exhausted movement cards pulse with `.is-draw-pending` and selected restores use `.is-draw-selected`.
- Timeline tooltips: use `.timeline-tooltip` with a `.timeline-tooltip-text` child for hover callouts on timeline action icons (X1/X2/i) and focus/rewind hover states; focused tooltips should list character power first, then focus-card text, anchored inside `.game-area`.

## Backgrounds and mood
- Use the base body gradient from `public/theme.css` to mirror the dark teal + gold fantasy mood. If new sections need emphasis, layer subtle radial glows (see `.hero-header::after`).

## Interaction patterns
- Inputs should use the shared focus ring from `public/theme.css`; keep outline and shadow consistent.
- Hover/active states must be derived from the existing button transitions (translateY, glow, and border highlight).

## Assets and motifs
- Favor ornamental framing through borders, gradients, and glows rather than heavy image assets. When adding imagery, keep it color-corrected to the palette.

## Documentation
- Update this file when introducing new reusable UI primitives. Reference the specific class names, variables, and intended usage.
