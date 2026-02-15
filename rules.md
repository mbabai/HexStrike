# HexStrike Rules

## Objective
Win by forcing the opponent to lose. A player loses if either:
- They are more than 4 hexes from the nearest land hex at any beat (distance loss).
- They are on abyss at the earliest open beat and have no playable cards.

## Components
- Hex board with a fixed 13-hex land island (rows of 5, 4, and 4) surrounded by abyss.
- Two characters, each with facing and a damage total.
- A deck of 4 movement cards and 12 ability cards per player.
- A shared timeline of beats.
- Damage icons and a Death marker (used by effects).

## Setup
1. Each player chooses a character and a deck (4 movement, 12 ability, no duplicates).
   - Deck building restrictions: `Step` is required in every deck and cannot be removed, and only one gold-titled movement card may be included per deck.
2. Place characters on opposite ends of land at the starting hexes; they face each other.
3. Each player lays out their 4 movement cards as available.
4. Each player draws the top 4 ability cards to form their hand; the remaining ability cards form the ability deck in deck order.

## Hand management
- Movement cards in hand follow the ability count:
  - If you have 4 or fewer ability cards, your movement hand must match that count.
  - If you have 5+ ability cards, your movement hand is capped at 4.
- When you use a movement card while holding 5+ ability cards, it immediately returns to your hand.
- "Draw X" means draw X ability cards, then (if you now have 4 or fewer ability cards) choose used movement cards to restore so the movement hand matches. If you already have 4+ ability cards/movement cards, skip the movement restore.
- "Discard X" means choose X ability cards to discard. If that puts you at 3 or fewer ability cards, discard the same number of movement cards so the hands match.

## Timeline and beats
- The game resolves in beats on a shared timeline.
- Each beat has one entry per player. An empty entry is shown as E.
- Only beats where both players have non-E actions resolve.
- The earliest beat where any player has E is the current open beat.

## Taking a turn (submitting an action set)
1. When you are at the earliest open beat, choose:
   - one active card and one passive card of opposite types (movement vs ability),
   - a rotation option allowed by the active card.
2. Place the active card's action list into your timeline starting at your first open beat.
3. The rotation applies only to the first beat of that action list; later beats use no rotation.
4. Any of your later entries beyond that insertion point are cleared.

## Rotation and facing
- Facing changes in 60-degree steps.
- Rotation choices are: 0, left 1 or 2 steps, right 1 or 2 steps, or a 180-degree turn.
- Rotation is applied before resolving the action on that beat.

## Action notation
- Each beat action is a string that can contain one or more tokens separated by `-`.
- A token is a path plus a type letter:
  - Types: m (move), j (jump), a (attack), b (block), c (charge: attack + move).
- Paths use relative directions to your facing:
  - F (forward), B (back), L, R, BL, BR.
  - A number indicates distance (e.g., `2m` is forward 2).
  - If the path is omitted, it defaults to 1 forward.
- W is a wait action. E is an open beat (no action).

## Resolving a beat
- Actions resolve by priority (higher first); ties go to player order.
- If you are hit before your action resolves, your action is skipped for that beat.
- Within a beat, each token uses your starting position and facing for that beat. Tokens resolve in order.
- Pre-existing arrow/projectile tokens resolve first each beat before player action tokens.

## Movement
- m: move step-by-step along the path, stopping before an occupied hex.
- j: jump directly to the destination; you cannot land on an occupied hex.
- c: resolves its attack first, then its movement.
- Moving through an arrow hex can trigger a hit during movement; jumps only check for arrow hits on the landing hex.

## Attacks and blocks
- a and c attacks target the destination hex of their path.
- If the opponent occupies the destination when the attack resolves, they are hit.
- b blocks create a block on your current hex in the direction of the block step (default forward).
- An attack from that direction into your hex is blocked if the block resolved earlier in the beat.
- Blocks do not stop throws.

## Damage and knockback
- Damage accumulates and is used to compute knockback; there is no health track.
- Each attack has a damage value and a knockback force (KBF).
- KBF results:
  - 0: no knockback and no stun.
  - 1: knock back 1 hex.
  - >1: knock back max(1, floor((total damage * KBF) / 10)).
- Knockback moves the target step-by-step along the attack direction, stopping early if blocked by another character.
- If knockback applies, the target's timeline is overwritten from that beat with Damage icons equal to (hexes actually moved + 1), followed by an E.

## Throws
- Some attacks are throws. When a throw hits, the attacker chooses one of the six directions.
- The game pauses at that beat until the direction is chosen.
- The target takes damage and is moved 2 hexes in the chosen direction if the landing hex is empty; otherwise they stay put.
- Throws ignore blocks.
- The Damage icon window is based on the number of hexes actually moved (plus one).

## Refresh
- When you reach the earliest open beat on land, you refresh:
  - clear movement exhaustion,
  - draw ability cards up to a hand size of 4.
- Refresh does not occur while a throw is pending or while simultaneous action submissions are still waiting to resolve.

## End of the game
- Distance loss: if a character is ever more than 4 hexes from the nearest land hex, they lose. A Death marker is placed on the next beat.
- No-cards abyss loss: if you are on an abyss hex at the earliest open beat and have no playable cards (no ability cards in hand and all movement cards exhausted), you lose.
- The remaining player wins.
