# HexStrike Alternate Rules (Co-existing Variant)

This document defines the alternate ruleset used by `public/cards/CardsAlternate.json`.

## 1) Per-Beat Stats And Sub-Beats

- Cards no longer use a single card-level `priority`, `damage`, or `kbf`.
- Each beat stores its own:
  - `action`
  - `subBeat`
  - `damage`
  - `kbf`
- `subBeat` supports two shapes:
  - Single value: `{ "value": N }`
  - Range: `{ "start": A, "end": B }`
- Allowed sub-beat values are integers `1` through `9`.

## 2) Sub-Beat Resolution Order

- Within a beat, resolve actions in sub-beat order `1 -> 9`.
- A sub-beat range acts on every sub-beat in the range.
- A given attack can hit the same target at most once per beat.

### Clash Resolution Hierarchy

When two actions conflict on the same sub-beat (or overlapping sub-beat ranges), resolve in this order:

1. Earlier-starting range wins.
   - Example: `3-6` beats `4-8`.
2. Base action class priority:
   - `Block > Attack > Movement > Other`
3. If both are the same class:
   - Attack vs Attack:
     - Higher `kbf` wins.
     - If `kbf` ties, higher `damage` wins.
     - If both tie, both attacks hit.
     - In FFA, if both attacks are on a third target and tie completely, defender chooses which hit determines knockback.
   - Movement vs Movement:
     - `Jump > Charge > Move`
     - If still tied (same movement type), no one moves.
   - Other vs Other:
     - No extra conflict rule needed beyond normal resolution.

## 3) Adrenaline Resource

- New player resource: `adrenaline`.
- Start value: `0`.
- Maximum value: `10`.
- New action tokens:
  - `Adr+X` adds adrenaline to the store.
  - `Adr-X` spends adrenaline from the store.
- On submission (active + passive + rotation), a player may also submit adrenaline up to their current store.
- Cards may define effects that scale from submitted adrenaline.

### Submitted-Adrenaline Text Convention

- Card text condition format uses `Adrenaline > N`.
- `Adrenaline > N` always means the amount submitted with that action set, not the current store value.
- `Adr+X` and `Adr-X` modify only the adrenaline store and do not change the already-submitted amount for the current action set.

### UI Adrenaline Icon Convention

- Use `/public/images/Adrenaline.png` as the adrenaline symbol.
- Store changes (`Adr+X`, `Adr-X`) show `+X` or `-X` inside the white heart.
- Conditional checks show `>N` or `<N` inside the white heart.
- "For each/for every X submitted Adrenaline" effects render with the adrenaline symbol inline and `X` (or the explicit value) inside the white heart.

## 4) Adrenaline Tie-Break Override

- For attack tie resolution, submitted adrenaline breaks ties.
- The player who submitted more adrenaline wins the tie.

## 5) Alternate Text Model

- `activeText` is replaced by beat-associated text and trigger text.
- Marker semantics:
  - `{i}` text is converted into beat-associated text and no longer requires an `i` marker.
  - `{X1}` and `{X2}` remain placeholders and are stored with text on their associated beats.
- Trigger effects that read like:
  - `If <card> is in your hand when ...`
  move into `triggerText`.
- `passiveText` remains passive text.

## 6) Adrenaline Visibility And Submission UX

- Adrenaline store starts at `0` and is tracked per player.
- In alternate-rules matches, each board token shows an adrenaline icon + value beside the player name.
- Submission secrecy rule:
  - Submitted adrenaline is hidden until the submitted action set is revealed on the timeline.
  - UI must not decrement visible store at submit-time; it updates only when timeline resolution reveals it.
- Action HUD includes an alternate-only adrenaline slider:
  - Range is always `0..10`.
  - Selection is capped to current visible store.
  - Slider handle uses `/public/images/Adrenaline.png`.
  - Track fill represents current store (yellow).
  - A gold cap line marks the current store limit.
- Timeline reveal:
  - When an action set is revealed, show the submitted adrenaline amount on that beat with the adrenaline icon and number.

## Current Data Preparation Rules Applied

For the initial alternate conversion baseline:

- Every beat keeps the original `action` value from `cards.json`.
- Sub-beat value is derived from legacy priority using:
  - `floor((100 - priority) / 10)`, clamped to `1..9`.
- `damage` and `kbf` are set only on attack beats.
- Non-attack beats have `damage: null` and `kbf: null`.

Current `CardsAlternate.json` card tuning has moved beyond this baseline and may intentionally diverge on beat actions, sub-beat values/ranges, and text.
