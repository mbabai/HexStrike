# HexStrike Rules

## 1. Overview

HexStrike is a two-player, simultaneous, card-based combat game on a hex board.

The objective is to force the opponent to lose by either:
- pushing them more than 4 hexes away from the nearest land hex, or
- reaching a state where they are on abyss at the earliest open beat with no playable cards and no valid ledge grab.

Time is structured as repeating **beats** on a shared timeline. Each player has one timeline entry per beat.

Players submit an **active card** and a **passive card** together. The active card provides the action list and base combat stats; the passive card modifies behavior.

When actions resolve in a beat, **priority** determines order (higher priority first; ties use fixed player order).

Play repeats beat by beat until a win condition is met.

## 2. Setup

### Deck Construction Rules

- Each deck contains **16 cards total**: 4 movement cards and 12 ability cards.
- No duplicate card IDs are allowed in a deck.
- `Step` is required in every deck and cannot be removed.
- Signature Move rule: cards with gold-title status are Signature Moves; maximum **1 Signature Move per deck**.
- Movement card count is fixed at 4.

### Starting State

1. Each player chooses a character and a legal deck.
2. Place both characters on starting land hexes at opposite ends, facing each other.
3. Set all movement cards to ready (not exhausted).
4. Set active/passive selection to none (no action set in play yet).
5. Draw 4 ability cards as the opening hand.
6. The remaining ability cards form that player's ability deck in deck order.

Clarifications:
- Ability decks are not shuffled by a baseline setup rule.
- No extra draw occurs beyond the opening draw above.

## 3. Game Flow

### 3.1 Round Structure Overview

The game runs in repeating beats. Each beat follows this order:

1. Refresh Phase
2. Simultaneous Play Phase
3. Beat Resolution
4. End of Beat
5. Proceed to next beat

## 4. Beat Phase - Detailed Explanation

### 4.1 Refresh Phase

- Refresh eligibility is checked at the earliest open beat (`E`) from the current unresolved frontier.
- A player refreshes only if that earliest open beat is on land.
- Refresh effects:
  - clear movement exhaustion,
  - draw ability cards up to full hand size (normally 4, modified by effects such as Focus).
- Refresh is blocked while required pending interactions/actions must resolve first.
- Passive/active clarification: players do not keep a global active/passive "in play" state between beats; ongoing effects persist only when a rule explicitly says they do (for example Focus or token-based effects).

### 4.2 Simultaneous Play Phase

- Any player who is at an eligible open beat chooses exactly:
  - one active card,
  - one passive card of the opposite type,
  - one legal rotation for the active card.
- The submission is locked when accepted by the server.
- The action list is inserted at that player's first open slot; the selected rotation applies only to the first inserted action entry unless later effects force rotation.
- If multiple players must submit at the same earliest beat, submissions are collected and revealed/resolved together.
- If a player cannot play at the earliest open beat, apply ledge grab first when eligible; otherwise resolve the no-cards abyss loss condition.

### 4.3 Beat Resolution

- Resolution order is priority descending; ties use fixed roster order.
- Rotation resolves before action token execution.
- Pre-existing projectile/token phases resolve before standard player action tokens when applicable.
- Multi-token actions resolve left-to-right within the action string.
- If a player is hit before their action resolves in that beat, their action for that beat is skipped.
- When interactions require decisions (for example throws), timeline progression pauses until the decision is provided.

### 4.4 End of Beat

- Apply finalized per-beat outcomes: damage total updates, knockback movement, timeline rewrites from hit windows, and token state updates.
- Expired one-beat effects end.
- Effects marked persistent remain until their own ending condition is met.
- Cleanup runs, then the game advances to the next earliest open beat.

## 5. Combat & Resolution Details

### Damage

- Damage is cumulative across the match.
- On hit, add the attack's damage value to the target's accumulated damage immediately.
- Damage is tracked per character and used by card effects and knockback calculations.

### Knockback

- Knockback is evaluated on hit after damage is added.
- Use attack knockback factor (KBF):
  - `KBF = 0` -> 0 knockback.
  - `KBF = 1` -> 1 hex knockback.
  - `KBF > 1` -> `max(1, floor((accumulatedDamage * KBF) / 10))`.
- Knockback direction follows the attack direction unless replaced by a special rule (for example throw).
- Movement is step-by-step; stop early if blocked by character collision/occupied hex constraints.
- Throws ignore normal block stopping and use throw-specific displacement rules.

### Interruptions / Overrides

- Priority order is the primary conflict resolver.
- If two effects still conflict after priority (same timing bucket), fixed roster order resolves ties.
- Throw resolution overrides normal knockback formula.
- Explicit card/effect text overrides generic timing defaults where the rule text states replacement behavior.

## 6. Advanced Interactions

### Focus

- Focus is a persistent state keyed by focus interactions on timeline beats.
- While active, the focused card remains in effect and can modify hand-cap/refresh behavior.
- Focus ends on its defined break conditions (including hit/knockback/stun-driven breaks where applicable), then return logic is applied.

### Board Tokens

- Board tokens are persistent board objects generated by card/effect resolution (for example fire, arrows, ethereal platform, focus anchor).
- Token placement uses effect-defined timing/locations.
- Token removal is rule-driven (consumption, expiration, or overwrite by later state).

### Persistent Effects

- Effects explicitly labeled persistent remain active across beats until a listed end condition occurs.
- Non-persistent effects expire during end-of-beat cleanup.

### Conditional Triggers

- Triggered effects resolve only when their trigger condition is satisfied.
- If multiple triggers are pending, they resolve in defined interaction order/timing order for that beat.

### Multi-beat Effects

- Some effects modify future timeline entries (for example hit windows, combo/rewind sequences, ongoing token playback).
- Timeline mutation must preserve committed future starts and deterministic order.

### Special Resolution Rules

- Throws pause resolution for direction choice.
- Combo/focus/interaction prompts can temporarily halt beat advancement.
- Execution resumes once required choices are resolved.

## 7. Symbols & Glossary

### Symbol Reference

| Symbol | Meaning |
| --- | --- |
| `E` | Open beat (no committed action) |
| `W` | Wait |
| `m` | Step movement |
| `j` | Jump movement |
| `a` | Attack |
| `b` | Block |
| `c` | Charge (attack + move resolution) |
| `F` | Focus marker/state reference |
| `Co` | Combo window marker |
| `DamageIcon` | Hit/stun timeline marker |

### Key Terms

- **Beat**: One timeline index containing one entry per player.
- **Priority**: Numeric order used for beat resolution; higher resolves first.
- **Active Card**: The selected card that supplies actions and base stats.
- **Passive Card**: The selected companion card that modifies active behavior.
- **Signature Move**: Gold-title movement card; max one per deck.
- **Refresh**: Land-gated refill step that clears movement exhaustion and draws up to hand cap.
- **Focus**: Persistent effect state tied to focus interactions.
- **Knockback**: Forced movement after hits, based on KBF and accumulated damage.
- **Action Set**: Active card + passive card + selected rotation submitted together.
- **Earliest Open Beat**: First unresolved open slot used for gating refresh and submission.

## 8. Quick Reference

### Fast-Play Summary

- Beat order:
  1. Refresh
  2. Simultaneous Play
  3. Beat Resolution
  4. End of Beat
  5. Next beat
- Priority reminder:
  1. Higher priority first
  2. Ties resolve by fixed roster order
- Damage/knockback:
  1. Add damage on hit first
  2. Apply KBF rule (`0`, `1`, or `max(1, floor((damage * KBF)/10))` for `KBF > 1`)
  3. Throw rules replace standard knockback
- Deck restrictions:
  1. 16 cards total (4 movement, 12 ability)
  2. No duplicates
  3. `Step` required
  4. Max 1 Signature Move (gold-title movement)
- Win condition:
  1. Opponent is >4 hexes from nearest land, or
  2. Opponent is on abyss at earliest open beat with no playable cards and no ledge grab
