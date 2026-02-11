# Character Powers

## Source of truth
- Character powers are defined in `public/characters/characters.json`.
- Each entry includes:
  - `id`
  - `name`
  - `image`
  - `powerText`
  - `effects` (data-only fields consumed by server/client rules)

## Runtime integration
- Server effect accessors: `src/game/characterPowers.ts`
- Server resolution usage: `src/game/execute.ts`
- Deck hand-size override plumbing: `src/server.ts` + `src/game/cardRules.ts` + `src/game/handRules.ts`
- Client catalog loading: `public/shared/characterCatalog.js`
- Client animation/playback parity: `public/game/timelinePlayback.js`
- UI display:
  - Deck builder character picker (`public/decks.js`)
  - In-game character-token hover tooltip (`public/game/timelineTooltip.js`)

## Current effect fields
- `maxHandSize`
- `attackDamageBonus`
- `drawOnKnockback`
- `damageReduction`
- `fireDamageImmune`
- `knockbackBonusPerTenDamage`
- `opponentDiscardReduction`

## Implementation notes
- Keep server execution and client timeline playback behavior in sync for every effect.
- For effects based on accumulated damage (for example `knockbackBonusPerTenDamage`), execution uses the attacker's current damage seeded from `public.characters[*].damage` at the start of `executeBeats`.
- Update or add tests in `test/characterPowers.test.js` when moving effects between characters or changing power math.
