# Documentation Guide

## Authority Rules

- `rules.md` is the exact mechanics source of truth.
- `public/rulebook.html` is the clarity-first player rulebook.
- `architecture.md` explains runtime structure.
- `README.md` is the setup/run entry point.
- `references/card-text-abstractions.md` tracks wording families, registries, and exceptions.

## Update Rules

When gameplay changes:
- update tests
- update `rules.md`
- update `references/card-text-abstractions.md` if a family/registry/exception changed
- update `public/rulebook.html` if player-facing explanation changed
- if new card-visible symbols or shorthand icons were introduced, update `src/shared/game/symbolTooltips.ts` and keep its copy aligned with `public/rulebook.html`

## Writing Rules

- `rules.md`: prefer exact behavior, explicit exceptions, and live terminology.
- `public/rulebook.html`: prefer clarity, examples, and teachable summaries.
- Never let the rulebook contradict `rules.md`.
- Do not render raw symbol codes in player-facing prose when image assets exist.
- WARNING: tooltip and rulebook symbol explanations should render icons inline instead of writing token strings like `2m`, `Bm`, `a-La-Ra`, `SigE`, or timing code names in plain text.
