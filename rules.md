# HexStrike Rules

This document is the exact implementation reference for the live codebase. When `rules.md`, tests, and runtime behavior disagree, fix the code or this file so they match. The in-app rulebook at `public/rulebook.html` is a clarity-first teaching document and may omit edge cases, but it must not contradict this file.

## 1. Scope

HexStrike currently ships as a server-authoritative Node.js prototype with a browser client. The server validates action submissions, resolves the shared beat timeline, owns hidden hand/deck state, and broadcasts player-specific views. This document covers the exact behavior that exists in code today, including current prototype/live systems such as adrenaline, free-for-all, draw offers, tutorial restrictions, hand triggers, and board tokens.

## 2. Decks and Match Setup

- A legal deck contains exactly 4 movement cards and 12 ability cards.
- Card IDs must be unique within the deck.
- `Step` is mandatory in every deck.
- Only one signature movement card is allowed per deck. The current signature movement cards are `grappling-hook`, `fleche`, and `leap`.
- Only two signature ability cards are allowed per deck. The current signature ability cards are `bow-shot`, `vengeance`, `spinning-back-kick`, `burning-strike`, `parry`, and `smoke-bomb`.
- Ability order is fixed. The default implementation does not shuffle ability decks.
- Character powers come from `public/characters/characters.json` and are active immediately once the match starts.
- In 1v1, players start on opposite starting land hexes facing each other. In FFA, setup expands to the configured roster/spawn logic.
- At match start, the server gives each player all 4 movement cards in their movement hand, 4 ability cards in their ability hand, and the remaining 8 ability cards in deck order.

## 3. Timeline Frontier, Open Beats, and Turn Gating

- The authoritative timeline is `state.public.beats`.
- `resolvedIndex` is the last beat where every entry is marked `calculated`.
- The actionable frontier starts at `resolvedIndex + 1`.
- Open beats are missing entries, `E`, `SigE`, or `F`. `F` is open for turn gating and action-set insertion, but it is not a refresh beat by itself.
- The earliest open beat is computed across all active players. Submission, refresh, HUD visibility, and timeline stop points all key off that earliest open beat.
- When multiple players share the earliest open beat, the server batches submissions in `pendingActions` and reveals them together once every required player has submitted.

## 4. Refresh, Hand Size, and Card State

### 4.1 Refresh

- Refresh is checked at the earliest open beat for each player.
- A player refreshes only when that earliest open beat is `E` or `SigE` on land. Ethereal platforms count as land for refresh.
- Refresh is blocked while required pending interactions or pending simultaneous submissions are unresolved.
- Refresh clears exhausted movement cards.
- Refresh draws ability cards until the player reaches max hand size.
- Base max hand size is 4. Focused cards can reduce the effective refresh cap.
- Movement hand size is derived from current ability count: up to 4 movement cards, capped by ability count when that count is 4 or less.
- Ability cards are never exhausted. On use they leave the hand immediately and go under the ability deck.
- `SigE` is a Signature Refresh beat. If that refresh resolves, the used active card goes to the top of the ability deck instead of the bottom.
- Movement cards exhaust on use and recover through refresh or other explicit rules.

### 4.2 Ledge Grab and No-Cards Loss

- A player on abyss at their earliest open beat loses if they have no playable movement/ability pair and no valid ledge grab path.
- Ledge grab is the current live escape valve for abyss/no-cards states and is checked before declaring the no-cards abyss loss.

## 5. Action Submission and Commitment

- An action submission must include `activeCardId`, `passiveCardId`, `rotation`, and optionally `adrenaline`.
- Active and passive cards must be opposite types.
- The server rebuilds the action list from card data and rejects unavailable, exhausted, or illegal card pairs.
- The action list is inserted at that player's first open unresolved beat.
- The selected rotation applies only to the first inserted entry unless a later rule forces rotation on another beat.
- `rotationSource: 'selected'` marks committed player-chosen starts. `rotationSource: 'forced'` marks card-text injections.
- Submitted adrenaline is locked when submitted, spends at the same time as the selected rotation, and does not depend on whether the first action later survives interruption.
- Submitted adrenaline is clamped to `0..10`.

## 6. Resolution Order

### 6.1 Phases

Per beat, the server resolves in this order:
- pre-existing arrow/token phases that occur before normal actions
- rotation / pre-action phase
- action timing buckets (`early`, then `mid`, then `late`)
- end-of-beat cleanup and timeline rewrites

### 6.2 Timing and Action Classes

- Timing data on cards/entries is authoritative. Numeric `priority` is compatibility metadata.
- Untimed/open actions such as `E`, `W`, and adrenaline utility labels do not enter the normal timing buckets.
- If two entries share timing, the engine breaks ties by action class and then roster order.
- Current action class order is: combo, throw, block, attack, move, focus, special, other.
- Throws are classed via shared throw specs, not scattered per-file allow lists.
- Same-class movement ties with different destination hexes resolve simultaneously. Those movers do not block each other's vacated hexes unless one of the moves fails and leaves its origin occupied.

## 7. Damage, Knockback, Interruptions, and Match-End State

### 7.1 Damage and Knockback

- Damage is cumulative match damage.
- Attack damage and KBF are stored on beat entries and read from those fields during resolution.
- Knockback uses accumulated damage after the hit:
  - `KBF = 0` -> 0 knockback
  - `KBF = 1` -> 1 knockback
  - `KBF > 1` -> `max(1, floor((damage * KBF) / 10))`
- Throws replace standard knockback distance/direction with throw handling.
- Multi-token attacks can hit the same target multiple times in one beat if later tokens still connect.

### 7.2 Interruption and DamageIcon Windows

- If a player is hit before their action resolves in that beat, their action for that beat is skipped.
- Hit rewrites use `DamageIcon` windows and may extend future beats.
- Replay mutators must preserve committed future starts (`rotationSource: 'selected'`, `comboStarter`, committed rewind-return starts).
- Same-beat `DamageIcon` interruption frames still count as active for some passive families:
  - Iron Will KBF reduction remains active.
  - Vengeance on-hit adrenaline remains active.
  - Spike discard immunity remains active.
  - Sweeping Strike KBF-to-discard conversion remains active.
  - Hammer reflection remains active.
- Hip Throw and Tackle throw immunity do **not** remain active on `DamageIcon` frames.

### 7.3 Match End

- In 1v1, a player loses when they are more than 4 hexes from the nearest land hex, or when they reach their earliest open beat on abyss with no cards to play and no valid ledge grab.
- Match outcome markers are synchronized on one beat through `applyMatchOutcomeToBeats`:
  - loser -> `Death`
  - winner -> `Victory`
  - draw agreement -> `Handshake`
- Later beats for the ended players are trimmed.

## 8. Exact Wording Families and Shared Registries

### 8.1 Throw family

The throw family is now driven by shared throw specs.

Current live throw cards:
- `hip-throw` active: unconditional throw interaction on attack entries.
- `tackle` active: unconditional throw interaction on attack entries.
- `leap` passive: unconditional throw interaction on paired attack entries.
- `grappling-hook` active: conditional throw. Its bracketed charge stops at first land or target, and it only becomes a throw when all of these are true:
  - the action set started on land
  - the resolving token is the bracketed `c` token
  - the target is adjacent at the hit moment

`triggerText` is not used to determine throws.

### 8.2 Pre-action family

Pre-action/start-of-action effects are now driven by shared pre-action specs.

Current live pre-action specs:
- `advance` passive: `adr +1`
- `dash` passive: `adr +1`
- `jump` passive: `adr +1`
- `step` passive: `adr -1`
- `sinking-shot` passive: take 2 damage and gain 1 adrenaline during the pre-action phase

Adrenaline utility action labels such as `Adr+1` still resolve from the action label itself.

### 8.3 Hand-trigger family

All current `If X is in your hand...` gameplay is sourced from the shared hand-trigger registry, not inferred from prose.

Current live hand-trigger cards:
- `burning-strike`: trigger on `attack-hit`
- `sinking-shot`: trigger on `projectile-hit`
- `vengeance`: trigger on `knockback-abyss`
- `iron-will`: trigger on `hit`

Shared live behavior:
- the card must still be in hand when the trigger condition happens
- the prompt is staged: reveal/confirm first, then discard selection if needed
- discard requirements are capped to current hand sizes
- `triggerText` is display copy only
- only the lowest `handTriggerOrder` pending interaction is interactable at a time

### 8.4 Passive modifier family

Passive modifier activation is driven by shared modifier specs.

Current live specs:
- `hip-throw` passive: throw immunity while the action set is active, excluding `DamageIcon`
- `tackle` passive: same as `hip-throw`
- `iron-will` passive: KBF reduction `-1` while active, including `DamageIcon`

### 8.5 Discard family

Discard-related behavior is driven by shared discard specs.

Current live specs:
- `down-slash` active hit -> discard 1
- `spike` active hit -> discard 3
- `sweeping-strike` active hit -> discard 2
- `trip` active hit -> discard 1 only if the center attack path hits
- `trip` passive -> if an opponent blocks your move, they discard 1
- `spike` passive -> discard immunity while active, including `DamageIcon`
- `sweeping-strike` passive -> convert KBF `X` into `Discard X` while active, including `DamageIcon`

Discard interactions always use the shared discard prompt/requirements flow.

## 9. Other Persistent Rule Families

### 9.1 Combo

- `Co` creates a combo window for the specific active card that caused the hit.
- Combo prompts pause on the `Co` beat before land refresh and before continuing past that beat.
- Throw-tagged hits do not open combo prompts.
- Skipped combo windows keep the `Co` symbol and mark `comboSkipped` for UI greying.

### 9.2 Guard

- Guard creates `guard-continue` interactions on Guard bracket frames.
- Choosing continue repeats from the Guard start through the first trailing `E`, replaces that `E`, and schedules a forced self-discard on the repeat-start beat.
- Guard prompts only open when the actor still has cards in hand.

### 9.3 Focus and Rewind

- `F` is an open beat.
- Rewind focus is tracked through `rewind-focus` interactions and `focusCardId` markers on beats.
- While focus is active, land refresh is blocked for that player and focused cards reduce max hand size.
- `rewind-return` choices only appear on focused `E` or implicit-open beats, not on the `F` beat itself.
- If the focused player has no playable pair, the server force-resolves return to anchor.

### 9.4 Active/passive swap

- `swap active with passive` rebuilds the action list using the former passive as the active card at the trigger beat.
- Only the trigger beat's rotation data carries over.
- Smoke Bomb `{X1}` uses this shared swap behavior.
- Reflex Dodge uses the same swap concept at execution time when hit during `W`.

## 10. Terrain and Board Tokens

- Terrain is derived from beat entry location plus land layout and stored on entries as `terrain`.
- Board tokens are reconstructed from timeline state during execution/playback. Historical re-execution must not seed from future `public.boardTokens`.
- Current board token types:
  - `fire-hex`: persistent damage zone, 1 damage per beat on occupied hex
  - `arrow`: moves 1 hex per beat, deals 4 damage and KBF 1, blocked by matching block walls, removed on hit/block/too-far-from-land
  - `ethereal-platform`: abyss-only refresh platform, consumed after a land-style refresh
  - `focus-anchor`: Rewind anchor marker
- Burning Strike passive movement fire only spawns on exact `m` and queues to the next beat after a successful move.
- Bow Shot passive arrow spawns on successful movement-type relocation tokens and uses the mover's pre-move hex.

## 11. Draw, Draw Offers, and Spectator-Relevant Live Systems

- Draw interactions (`type: 'draw'`) are runtime interactions used by cards/effects such as Jab or Absorb.
- Match draw offers use `/api/v1/game/draw-offer`, have a 30-second server cooldown per offerer, and create a `draw-offer` interaction for human opponents.
- Bot draw-offer acceptance is difficulty-based.
- Spectator mode is live replay-style rendering fed by `spectator:update` events and the live-game watch/unwatch endpoints.

## 12. Free-For-All and Tutorial Appendices

### 12.1 FFA

- FFA enables automatically when roster size is at least 3.
- Current defaults:
  - 2 points to win
  - 10 death beats before respawn
  - 5 invulnerable beats after respawn
  - respawn center at `(0,0)`
- Eliminated players respawn with 0 damage and refreshed state according to FFA lifecycle rules.
- The last eligible attacker to hit an eliminated player gets the point.

### 12.2 Tutorial

- Tutorial queue is a scripted match with forced decks, characters, action sequences, and interaction validation.
- Tutorial flow intentionally suppresses certain normal options so the scripted path stays deterministic.
- Tutorial matches auto-complete through explicit outcome application once the scripted path is exhausted.

## 13. Symbol and State Glossary

- `E`: open/refresh beat with no committed action
- `SigE`: signature refresh beat; refreshes like `E`, but the active card returns to the top of the deck if the refresh happens
- `F`: focused open beat
- `W`: wait
- `m`: move
- `j`: jump
- `c`: charge / attack-move style token
- `a`: attack
- `b`: block
- `Co`: combo window
- `DamageIcon`: interruption/hit window marker
- `rotationSource: 'selected'`: player-committed start
- `rotationSource: 'forced'`: card-text injected rotation

## 14. Current Intentional Live Exceptions

- `grappling-hook` is part of the throw family but remains conditional, not unconditional.
- `triggerText` is UI copy only. Gameplay for hand triggers comes from the shared hand-trigger registry.
- `healing-harmony` active currently heals only the acting character. Team-wide ally healing is not implemented yet.
- `rules.md` is exact. `public/rulebook.html` is explanatory.
