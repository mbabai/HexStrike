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

## Writing Rules

- `rules.md`: prefer exact behavior, explicit exceptions, and live terminology.
- `public/rulebook.html`: prefer clarity, examples, and teachable summaries.
- Never let the rulebook contradict `rules.md`.
- Do not render raw symbol codes in player-facing prose when image assets exist.
