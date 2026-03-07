# Card Text Abstractions

This file tracks how recurring card wording maps to shared rule machinery. `rules.md` is the exact mechanics reference; this file is the implementation map for contributors.

## Shared-Core Ownership

Pure rule logic that both server and browser need should live in `src/shared/game` and build into `public/generated/shared/game`.

Use these shared registries first when new wording matches an existing family:
- `src/shared/game/throwSpecs.ts`
- `src/shared/game/preActionSpecs.ts`
- `src/shared/game/handTriggers.ts`
- `src/shared/game/cardText/passiveModifierSpecs.ts`
- `src/shared/game/cardText/discardSpecs.ts`
- `src/shared/game/cardText/actionListTransforms.ts`
- `src/shared/game/cardText/actionListBuilder.ts`

Server wrappers in `src/game/*` and browser wrappers in `public/game/*` should stay thin.

## Deckbuilding Metadata

- Signature deckbuilding limits are sourced from `public/cards/cards.json` card metadata, not hard-coded UI-only lists.
- `signatureGroup: "movement"` marks a gold-title Signature Move and is limited to one per deck.
- `signatureGroup: "ability"` marks a gold-title Signature Ability and is limited to two per deck.
- Current signature abilities: `bow-shot`, `vengeance`, `spinning-back-kick`, `burning-strike`, `parry`, `smoke-bomb`.

## Action-Symbol Anchors

- `{i}`: the bracketed action token(s) in the action list. Effects that reference `{i}` should target the bracketed action index, not a later split token by accident.
- `{SigE}`: signature refresh action. It is still an open/refresh beat, but if that refresh resolves the active card returns to the top of the ability deck instead of the bottom.
- `{adr+X}` / `{adr-X}`: current adrenaline pool modifiers.
- `{adrX}`: submitted-adrenaline scalar. In damage text, add the locked submitted adrenaline value for that action set.
- `{adrN}`: submitted-adrenaline threshold check.
- `Adr+N` action labels: untimed utility labels that modify adrenaline during beat execution; they are not attack/move/block actions.

## Symbol Tooltip Registry

- Player-facing card symbol tooltip copy is owned by `src/shared/game/symbolTooltips.ts`.
- Browser hover rendering lives in `public/shared/cardSymbolTooltips.js`.
- Card DOM symbol markers are attached in `public/shared/cardRenderer.js`.
- WARNING: this registry must use icon-friendly wording. Do not write raw token strings like `2m`, `Bm`, `a-La-Ra`, `SigE`, `X1`, or timing code names in player-facing copy when those symbols can be shown inline.
- When a card introduces a new visible symbol, shorthand icon, or stat-style marker, update all three so the hover tooltip text stays identical to the rulebook wording.

## Symbol Matching Rule

- Match exact symbols by default.
- Broaden to category-wide matching only when the text explicitly says a category such as "attacks", "movement", or "jumps".
- Word-form movement references are broader than symbol-form references:
  - symbol form like `{m}` or `{c}` means that exact anchor
  - word form like `move` or `movement` means movement-style relocation generally
- Timed shorthand uses `{token}[early|mid|late]`.

## Throw Family

Throw behavior is driven by `src/shared/game/throwSpecs.ts`.

Current shared specs:
- `hip-throw` active: unconditional throw interaction
- `tackle` active: unconditional throw interaction
- `leap` passive: unconditional throw interaction
- `grappling-hook` active: conditional throw with explicit condition id `grappling-hook-land-start-adjacent-target`

Implementation notes:
- Action-class tagging for tie-break order comes from the same throw spec family.
- `grappling-hook` is intentionally part of the throw family but not an unconditional throw card.
- Runtime-only Grappling Hook behavior that is not generic throw classification, such as the passive flip/follow-through handling, still lives in `src/game/execute.ts` and `public/game/timelinePlayback.js`.

## Hand-Trigger Family

All `If X is in your hand...` gameplay is driven by `src/shared/game/handTriggers.ts`.

Current trigger cards:
- `burning-strike`
- `sinking-shot`
- `vengeance`
- `iron-will`

Shared behavior:
- the card must still be in hand when the trigger happens
- confirm/reveal prompt happens before discard selection
- discard requirements are capped to current hand sizes
- only the lowest `handTriggerOrder` pending interaction is interactable
- `triggerText` is display copy only

Execution/UI anchors:
- server resolution: `src/game/execute.ts`
- client prompt flow: `public/game/handTriggerPrompt.mjs`
- tooltip/timeline copy: `public/game/timelineTooltip.js`, `public/game/handTriggerText.mjs`

## Pre-Action Family

Start-of-action effects that resolve with the selected rotation live in `src/shared/game/preActionSpecs.ts`.

Current shared specs:
- `advance` passive: gain 1 adrenaline
- `dash` passive: gain 1 adrenaline
- `jump` passive: gain 1 adrenaline
- `step` passive: lose 1 adrenaline
- `sinking-shot` passive: take 2 self-damage and gain 1 adrenaline

Use this family for card-start effects that are not tied to a specific beat token.

## Passive Modifier Family

Ongoing passive combat modifiers live in `src/shared/game/cardText/passiveModifierSpecs.ts`.

Current shared specs:
- `hip-throw` passive: throw immunity while active, excluding `DamageIcon`
- `tackle` passive: throw immunity while active, excluding `DamageIcon`
- `iron-will` passive: KBF reduction 1 while active, including `DamageIcon`

Do not generalize `DamageIcon` handling. The live rule is family-specific:
- Iron Will, Spike, Sweeping Strike, Vengeance, and Hammer-style hit-reactive checks still count the interruption frame as active.
- Hip Throw and Tackle throw immunity do not.

## Discard Family

Discard-related behavior lives in `src/shared/game/cardText/discardSpecs.ts`.

Current shared specs:
- `down-slash` active hit: discard 1
- `spike` active hit: discard 3
- `sweeping-strike` active hit: discard 2
- `trip` active hit: discard 1 on center-line hit only
- `trip` passive: if an opponent blocks your move, they discard 1
- `spike` passive: discard immunity while active, including `DamageIcon`
- `sweeping-strike` passive: convert KBF `X` into `Discard X` while active, including `DamageIcon`

Prompt/UI flow remains shared through the normal discard interaction pipeline.

## Action-List Transforms

When card text adds, removes, replaces, or retimes action entries, use `src/shared/game/cardText/actionListTransforms.ts`.

This is the shared anchor for:
- exact symbol replacement
- bracket-aware token splitting/parsing
- timing injection on inserted entries
- preserving action-list precision across server execution and browser preview

## Action-List Building

Card-driven action-list mutations should flow through `src/shared/game/cardText/actionListBuilder.ts` and its sibling shared card-text modules.

Current shared card-text modules:
- `src/shared/game/cardText/activeAbility.ts`
- `src/shared/game/cardText/activeMovement.ts`
- `src/shared/game/cardText/passiveAbility.ts`
- `src/shared/game/cardText/passiveMovement.ts`
- `src/shared/game/cardText/combatModifiers.ts`
- `src/shared/game/cardText/discardEffects.ts`

If a new card family can be expressed as shared list-building or modifier logic, add it there before extending `execute.ts`.

## Swap Family

`swap active with passive` means:
- rebuild the action list immediately at the trigger beat
- use the old passive as the new active and the old active as the new passive
- carry only the trigger beat's `rotation` and `rotationSource`

Current users:
- Smoke Bomb `{X1}` through shared action-list building
- Reflex Dodge at execution time on hit during `W`

## Other Interaction Families

- Guard continue: `customInteractions` type `guard-continue`, repeated from Guard start through first trailing open beat
- Combo: `Co` opens a card-specific continuation window and is blocked by throw-tagged hits
- Focus/Rewind: `rewind-focus` and `rewind-return` interactions manage anchor state and focused-card hand limits
- Haven: `haven-platform` interaction chooses a touching abyss hex for the ethereal platform

These are still primarily execution-driven rather than registry-driven, but they should reuse shared action-list and timing helpers where possible.

## Board Tokens and Triggered Side Effects

- Burning Strike passive fire from movement only triggers on exact `m` and queues to the next beat after the move succeeds.
- Bow Shot passive arrow spawns on successful movement-style relocation and uses the mover's pre-move hex.
- Arrow damage is fixed at 4 with KBF 1 and does not inherit character attack bonuses.
- Historical re-execution must rebuild tokens from timeline state, not from future `public.boardTokens`.

## Known Intentional Exceptions

- `grappling-hook` shares the throw-family abstraction but remains conditional.
- `triggerText` is display-only even when the prose looks mechanically complete.
- `healing-harmony` active currently heals only the acting character because team/ally support is not implemented.
