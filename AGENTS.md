# HexStrike Agent Guide

## Vision (long-term)
HexStrike is a Node.js, server-driven living card game played over a hex-grid. Players submit actions built from selected cards; the server validates, resolves outcomes on the hex board, and advances the authoritative game timeline. Clients are expected to connect via WebSockets and receive partial game states (their own hand and public board info; no opponent hand/deck visibility). The experience should feel like collaboratively making a movie that can be rewound and replayed.

## Current scope (lobby prototype)
- Server: dependency-light Node.js + TypeScript HTTP server in `src/server.ts` with REST endpoints and SSE (`GET /events`).
- State: lobby queues (`quickplayQueue`, `rankedQueue`, `botQueue`) and in-memory match/game records via `src/state/lobby.ts` and `src/persistence/memoryDb.ts`; games now include starting characters assigned on queue join.
- Server: action-set validation uses `src/game/cardCatalog.ts` + `src/game/cardRules.ts` to enforce deck/hand exhaustion, rotation limits, and refresh timing.
- Server: hand management + draw/discard syncing lives in `src/game/handRules.ts` (movement hand derived from ability count).
- UI: static assets in `public/` with ES module scripts (`public/menu.js`, `public/queue.js`, `public/storage.js`) and styling in `public/theme.css`.
- UI: lobby deck library + deck builder (stored per-user in localStorage) in `public/decks.js` + `public/deckStore.js`; selected deck is saved in cookies and gates matchmaking.
- UI: deck edit uses the same builder overlay as create; edit state is prefilled and saves back to the existing deck id.
- UI: `/cards` catalog page renders the full card set from `public/cards/cards.json` via `public/cards.js` + `public/cards.css`.
- UI action HUD uses movement/ability cards from `public/cards/cards.json`, random/selected deck hand selection in `public/game/cards.js`, and drag/drop wiring in `public/game/actionHud.js`.
- Action HUD hands are always rendered in a stacked spread, with turn-only slots/rotation and icon-driven card badges.
- UI match-end rule checks are centralized in `public/game/matchEndRules.js` to keep game-over logic separate from controller wiring.
- Server match outcomes are evaluated in `src/game/matchEndRules.ts` and stored on `state.public.matchOutcome`.
- Front-end animation: `public/game/timelinePlayback.js` builds beat-by-beat scenes (characters + effects) consumed by `public/game/renderer.js`.
- UI portrait badges (name capsules) are drawn with `public/game/portraitBadges.js`; local player accents use `--color-player-accent`.
- Timeline controls: play/pause is rendered in the center time slot and auto-advance steps when the current beat playback completes.
- UI timeline shows a local-only pending action preview (faded + pulsing) when you've submitted and are waiting on other players.
- Matchmaking: Quickplay join/leave is wired from the UI; other queue options are placeholders.

# Documentation map (start here)
- [README.md](README.md): project overview, setup, and API summary; read first when onboarding or running the server.
- [PLANS.md](PLANS.md): ExecPlan format and rules; use whenever drafting or executing a large feature/refactor plan.
- [front-end-ui.md](front-end-ui.md): UI palette, components, and interaction rules; use for any browser-facing UI changes.
- [architecture.md](architecture.md): system overview of server/client/data flow; use when onboarding, tracing state sync issues, or planning cross-cutting changes.
- [rules.md](rules.md): player-facing rules; use to align gameplay changes, answer rules questions, or sanity-check rule coverage.
- [docs/hex-grid.md](docs/hex-grid.md): hex coordinate system and land/abyss definitions; use when touching board math or terrain.
- [references/card-text-abstractions.md](references/card-text-abstractions.md): inventory of card-text symbols/effects and their implementation anchors.
- [references/card-text-implementation.json](references/card-text-implementation.json): active/passive card-text implementation tracker.
- [plans/basic-lobby.md](plans/basic-lobby.md): historical lobby plan snapshot; reference for context on the initial lobby scope.
- [plans/queue-matchmaking-game-area.md](plans/queue-matchmaking-game-area.md): historical plan for queue/matchmaking/game surface; reference when revisiting those areas.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `PLANS.md`) from design to implementation.

## Architectural principles (current)
- Front-end UI: For any browser-facing UI styling or layout, follow `front-end-ui.md` as the single source of truth for palette, components, and interactions. Extend that document when adding reusable primitives.
- Platform: Node.js with TypeScript preferred for type safety; keep server code framework-light (dependency-light HTTP + SSE).
- Bounded contexts (implemented): `matchmaking` (lobby, seat assignment, game bootstrap) and `persistence` (in-memory data).
- State model: Lobby snapshots and match/game records are kept in memory; no frame ledger exists yet. Game public state includes `characterName` on characters, `customInteractions`, and beats reference players by `username`.

## Realtime and client interactions (current)
- SSE message envelope: `{ type, payload, recipient }`.
- Message types currently emitted: `connected`, `queueChanged`, `match:created`, `game:update`, `match:ended`.
- REST endpoints live under `/api/v1/lobby`, `/api/v1/match`, `/api/v1/history`, and `/api/v1/game/interaction` (plus `/api/v1/match/:id/exit` for per-player leave).
- `game:update` payloads may include `pendingActions` in public state when concurrent players are submitting action sets.
- `game:update` payloads may include `customInteractions` (pending/resolved) that pause the timeline until resolved.
- `game:update` payloads may include `matchOutcome` once the server declares a winner/loser.

## Persistence and operations (current)
- `MemoryDb` in `src/persistence/memoryDb.ts` is the only persistence layer and resets on restart.
- Quickplay joins are logged to the server console for visibility.

## Testing and validation (current)
- Use the Node.js built-in test runner (`npm run test`).
- `npm run dev` builds, runs tests, and only starts the server when tests pass.
- Any new or edited card in `public/cards/cards.json` must include simulation tests that validate both roles (card as `activeCardId` and as `passiveCardId`) by executing timelines and asserting beat entries; action-list-only coverage is not sufficient.

## Planned gameplay architecture (future)
- Bounded contexts: `rules`, `engine`, `realtime`, and a durable `persistence` layer for frame replays.
- State model: Treat each frame as an immutable record containing inputs (actions), deterministic resolution output, and derived public/secret views. Store frames sequentially to enable rewind/fast-forward.
- Data flow: client action -> validation -> deterministic frame resolution -> persistence append -> realtime broadcast.
- Idempotency and ordering: actions include frame indices and player IDs; server enforces monotonic progression and rejects duplicates.
- Concurrency: support simultaneous turns by collecting all required player actions before resolution; implement timeouts/fallbacks for missing actions.
- Determinism: randomness seeded per match and recorded in the frame.
- Board and rules: represent the hex grid with axial or cube coordinates; card definitions are data-driven and versioned; rule resolution should be pure functions.

## Style and conventions
- Use TypeScript; the Node build targets ES2020 and CommonJS output today. Add eslint/prettier defaults if introduced; no try/catch around imports.
- Keep pure logic (rules/engine) free of I/O; isolate side effects in adapters.
- Small, focused modules; avoid monolithic files.
- Prefer functional, deterministic code paths for the engine; inject randomness sources.

## Repository conventions
- Add new AGENTS.md files in subdirectories when specialized instructions are needed; nested instructions override this file.
- Document new protocols (message schemas, frame structure) in `docs/` with examples.
- Update this guide if architectural decisions change.

## Gotchas (current)
- Beat entries include `damage`, `location`, and `priority` fields; tests should assert full beat payloads, not just `username`/`action`.
- Beat entries include `terrain` (`land`/`abyss`) derived from `location` + `public.land`; refresh/abyss logic should prefer this flag.
- Action-set insertion is per player: replace that player's first open slot (missing entry or `E`), fill empty beats in place, and avoid shifting other players' beats.
- Action-set rotations use the player-selected rotation only on the first action entry; later rotations are reserved for card-text injections and should set `rotationSource: 'forced'`.
- Action-set submissions must include `activeCardId`, `passiveCardId`, and `rotation`; the server rebuilds the action list from the card catalog and rejects unavailable or exhausted cards.
- Fleche passive skips the final `W` in the active ability action list if any prior action token contains an `a`; keep `src/game/cardText/passiveMovement.ts` and `public/game/cardText/passiveMovement.js` in sync.
- Ninja Roll passive only transforms exact `{a}` or `[a]` tokens; do not broaden other attack strings (ex: `a-2a`, `a-La-Ra`).
- Card-text timeline edits (add/remove/replace actions) should use `actionListTransforms` helpers on both server/client to keep precision and parity.
- Card additions/edits must update simulation coverage in `test/cardTimelineSimulations.test.js` (or equivalent) so every card has active + passive timeline assertions through `validateActionSubmission` -> `applyActionSetToBeats` -> `executeBeats`.
- If card text introduces new action tokens (ex: `2c`, `B2m`, `B3j`), the HUD needs `/public/images/{token}.png`; generate via `scripts/hex_diagrams_creator.py` (or the `action-diagram-creator` skill, which outputs to `public/images`).
- Ability cards are never exhausted; on use they leave the hand immediately and are placed under the ability deck (client and server).
- Movement hand size is derived from ability count (<=4 matches ability count, >4 caps at 4); use `syncMovementHand`/`getMovementHandIds` in `src/game/handRules.ts` instead of hand-counting on the client.
- Movement exhaustion clears on any land `E` at the earliest timeline index; the refresh is keyed to the earliest `E`, not the client view index.
- On land `E`, draw from the ability deck until reaching max hand size (`MAX_HAND_SIZE`, default 4).
- Ability draw/discard helpers (`drawAbilityCards`, `discardAbilityCards`) always sync movement hand; avoid mutating `exhaustedMovementIds` directly when resolving card text.
- Action HUD only shows when the timeline selector is on the earliest `E` across all players and the local player is at-bat; the HUD locks after submit until resolution.
- Action HUD hands are always visible in the game view; only the slots and rotation wheel toggle with the `.is-turn` state.
- Discard interactions reuse the existing hand UI: `public/game/discardPrompt.mjs` applies `.is-discard-pending` (pulsing) and `.is-discard-selected` (grey) on in-hand `.action-card` elements instead of rendering a separate discard hand; keep the `.action-hud.is-locked` override in `public/theme.css` so greyscale remains visible while the HUD is locked.
- Discard requirements are capped to current hand sizes; if required >= cards in hand for a type, the client auto-selects all and auto-submits the discard.
- Hand-trigger prompts are staged: confirm "Use X?" first, then show the discard selection; `public/game/handTriggerPrompt.mjs` owns the reveal glow on the trigger card and discard glow on extra cards.
- Pending hand-trigger interactions are globally ordered by `handTriggerOrder`; only the lowest order is interactive (`public/game/handTriggerOrder.mjs` + `src/server.ts`).
- Action HUD hover targeting is based on the hand column + header band (not card transforms); keep `--action-card-hover-shift` synced with the hover rail in `public/game/actionHud.js`.
- Action HUD card text uses `public/shared/cardRenderer.js`; call `fitAllCardText` after hand renders so active/passive text fits the surface rows.
- Action HUD click selection: empty slots -> active; active filled + same type -> replace active; active filled + different type -> fill passive; both filled -> replace matching type slot; clicking a slotted card returns it to hand.
- Active/passive slots must be filled with cards from different sides (movement vs ability); only the active card drives the action list and rotation restrictions.
- Slot assignment overwrites same-type cards in the opposite slot by returning them to the hand.
- Action card UI always appends an `E` symbol and uses `/public/images/rot*.png`, `priority.png`, `DamageIcon.png`, and `KnockBackIcon.png`.
- Action card stat badges are anchored bottom-left with overlapping icons (damage left, knockback right), and the surface panel is split into 50%/25%/25% vertical bands with square corners in `public/theme.css`.
- Action card layout uses fixed pixel positions via CSS variables in `public/theme.css`; scale with `--action-card-scale` (cards page sets `1.5` in `public/cards.css`) instead of resizing individual elements to keep proportions locked.
- Deck selection cards use `--action-card-scale` and `--deck-selection-hover-lift` in `public/theme.css`; keep the hover lift padding in sync so elevated cards are not clipped.
- Action icon column placement is controlled by `--action-card-actions-top` in `public/theme.css`; adjust that single value to keep the top icon aligned without colliding with the border.
- Keep beat arrays ordered by character roster when mutating to prevent UI rows from swapping entries.
- Do not synthesize missing beat entries just to fill the timeline; missing entries count as `E` and prevent trailing-E spam.
- Earliest-`E` lookups used for action submission/HUD gating must ignore calculated history (`calculated: true`) and start at the first unresolved beat (`resolvedIndex + 1`), or cards can be consumed into past beats (not inserted) after parry/damage rewrites.
- Parry cleanup must not wipe newly submitted future action-set starts: when forcing the defender to `E` on the counter beat, only clear stale continuation entries and preserve future entries tagged with `rotationSource: 'selected'`/`comboStarter`.
- Timeline scrolling must clamp to the earliest `E` across all players, not just the local user.
- Timeline gold highlight uses the earliest `E` beat across all players, not the currently viewed beat.
- Timeline play/pause replaces the center beat label; hit detection is a circular button in `public/game/timeIndicatorView.js` and auto-advance only steps after playback reports completion.
- Timeline playback should advance beat-by-beat to the stop index; do not auto-jump the time indicator to the latest stop index on `game:update` or intermediate animations will be skipped.
- Timeline tooltips use `cardId`/`passiveCardId` on beat entries for active/passive names; symbol instructions still come from `{X1}/{X2}/{i}` fragments in `activeText`.
- Timeline tooltip action-set start prefers `rotationSource: 'selected'` and falls back to non-empty `rotation` when the source flag is missing (legacy data).
- Hit rewrites clear `cardId`/`passiveCardId` on `DamageIcon`/forced `E` entries, except the first `DamageIcon` keeps the active/passive ids so the tooltip can show the interrupted action set.
- Rotation restrictions like `0-2` are interpreted as rotation magnitude (both left/right labels plus `0`/`3` where applicable), not directional ranges.
- Rotations resolve in a pre-action phase; apply them even if the actor's action is skipped/disabled, and keep `src/game/execute.ts` + `public/game/timelinePlayback.js` in sync.
- When multiple players share the earliest `E`, the server batches action sets in `pendingActions` and reveals them simultaneously once all required players submit; timeline rings blink red for players still needed.
- Pending action previews on the timeline are client-side only: build the local player's preview from the submitted active card action list, render it as a faded pulsing overlay only on that player's `E` slots while waiting, and clear it once `pendingActions` no longer includes a local submission.
- Direction indexing for blocks/attacks must ignore reverse vectors (only forward, positive steps); otherwise block walls flip away from facing.
- Keep `getDirectionIndex` logic in `public/game/timelinePlayback.js` and `src/game/execute.ts` synchronized so visuals match server resolution.
- Rotation parsing treats `R` as +60 degrees per step and `L` as -60; keep that sign consistent in `public/game/timelinePlayback.js` and `src/game/execute.ts`.
- Arrow/projectile hits must respect block walls; client token playback derives block lookups from block effects to stop arrows on blocks.
- Board tokens live in `public.boardTokens`; `executeBeatsWithInteractions` rebuilds fire/arrow tokens from beats, moves only pre-existing arrows each beat, and applies fire damage after arrow resolution.
- Haven active uses a `customInteractions` entry of type `haven-platform`; client targeting/hover math is centralized in `public/game/havenInteraction.mjs` and renderer should stay draw-only via `interactionHighlightState`.
- Ethereal platforms only persist on abyss, grant land-style refresh when a player has `E` on them, and are consumed during `resolveLandRefreshes` once refresh resolves.
- Client board-token playback is derived from beats/interactions in `public/game/timelinePlayback.js` (`buildTokenPlayback`); keep token spawn logic in sync with server-side rules so timeline scrubbing matches resolution.
- Fire hex tokens render as full-hex overlays (no facing arrow); keep `public/game/renderer.js` token drawing in sync with any token art changes.
- Burning Strike optional ignites via a `customInteractions` entry of type `burning-strike` (discardCount `1`, `attackHexes`); avoid re-triggering if an interaction already exists for that beat.
- Guard active uses `customInteractions` of type `guard-continue`; choosing continue repeats from the bracketed Guard start through the first trailing `E` (explicit or implicit/missing entry), replaces that `E`, and schedules a forced discard on the repeat-start beat.
- Guard continue prompts can re-open on repeated Guard start frames even when that frame is the current `resolvedIndex`; only create the prompt when the actor still has at least one card in hand (movement + ability) so the forced discard is possible.
- Combo prompts pause on the `Co` beat before any action/E resolution, and choosing to continue skips land refresh/draw for that player at that beat.
- Combo continuation is tied to a specific active card (`cardId` on action list/beat entry); only hits from that card can open the combo prompt.
- Throw interactions are tagged from card text (`throw` keyword in the active card's active/passive text and the passive card's passive text only); combo prompts only open on non-throw hits.
- Hip Throw/Tackle passives grant throw immunity while their action set is active (non-`E`), blocking throws from any direction; keep `cardText/combatModifiers` mirrored server/client.
- Iron Will passive reduces KBF by 1 (min 0) on hits, including projectiles, while the action set is active; hand-trigger use still sets KBF to 0.
- Jab active `{i}` draws 1 by emitting a `draw` interaction on the bracketed attack step.
- Active ability card text is handled in `src/game/cardText/activeAbility.ts` + `public/game/cardText/activeAbility.js`; Counter Attack shifts the selected rotation to after `{i}` by clearing the start rotation and applying a forced rotation on the next entry.
- The combo modal is filtered to the actor's beat entry by userId/username; keep interaction actor resolution aligned with roster identifiers.
- Cards can opt out of throw keyword detection by id (e.g., `grappling-hook`).
- Grappling Hook uses `cardStartTerrain` to gate its conditional throw (throw only if the action set started on land), and its `{i}` bracketed charge stops at the first land tile or target in front.
- Grappling Hook passive flips landed `{a}` hits to the opposite side of the attacker before knockback; keep the inversion logic in sync between `src/game/execute.ts` and `public/game/timelinePlayback.js`.
- Pending throw interactions must surface the throw modal even if the beat is already resolved; don't filter throws by resolved index in the UI selector.
- Skipped combos keep the `Co` symbol on the timeline and are marked with `comboSkipped` for UI greying; do not replace with `W`.
- Server-side deck state is tracked per game (in memory); refreshes resolve only when the earliest `E` is on land (gated by `lastRefreshIndex`), clearing movement exhaustion and drawing up to max hand size.
- Land refresh checks should use the last known beat location at/ before the earliest `E`; avoid `public.characters` positions or you will refresh on abyss.
- Land refresh should be keyed only by `lastRefreshIndex` + earliest `E` beat; skip refresh entirely while `pendingActions.beatIndex` matches the earliest `E`.
- If a hit or custom interaction rewrites a player timeline forward, clamp that player's pending refresh beat to their current first `E` or it will block subsequent action submissions.
- Knockback distance uses accumulated damage after the hit plus card KBF: `KBF=0 -> 0`, `KBF=1 -> 1`, `KBF>1 -> max(1, floor((damage * KBF) / 10))`; hits record `BeatEntry.consequences` with damage delta + actual knocked steps and only rewrite the timeline starting on the next beat if the target already acted.
- Damage/knockback overlays on the timeline come from `BeatEntry.consequences`, not accumulated `damage`.
- Timeline hit badge placement is tuned via `KNOCKBACK_BADGE_OUTSET`, `DAMAGE_BADGE_OUTSET`, and `BADGE_NUDGE_X` in `public/game/timeIndicatorView.js`.
- Attack damage/KBF are taken from the active card and stored on beat entries (`attackDamage`, `attackKbf`); both server and client resolution read from those fields.
- Match outcomes live in `public.matchOutcome`: distance loss uses the earliest beat where a character is more than 4 hexes from land, places `Death` on the next beat (clearing later entries for that character), and no-cards abyss loss only triggers at the earliest `E` for that player.
- The Game Over Continue button calls `/api/v1/match/:id/exit` and only removes the local player from the match; the other player stays in-game until they exit or the match is completed.
- When knockback has already been applied, re-execution must not erase actions placed after the trailing `E`; only the damage-icon window is authoritative.
- `executeBeats` seeds from `public.characters` (start-of-timeline); do not seed from beat 0 entries because beats store end-of-beat locations and will drift on re-exec.
- Node test runner reads from `dist`; run `npm run build` (or `tsc`) before `node --test test` when working on TS source.
- Timeline row separators must render before portrait rings so the local player highlight is visually on top.
- Board damage capsules are offset outside the ring and drawn without clipping so they sit over the border.
- Name capsule sizing is centralized in `public/game/portraitBadges.js`; pass config overrides for board vs timeline to keep consistency.
- Timeline playback timing is tuned in `public/game/timelinePlayback.js` via `ACTION_DURATION_MS` plus swipe/hit/knockback windows; adjust there before changing renderer effects.
- Abyss grid borders are rendered via `drawAbyssGrid` in `public/game/abyssRendering.mjs`; keep `minLineWidth = max(baseLineWidth * 0.2, 1 / (dpr * scale))` to avoid vanishing outlines at high zoom.
- Trails are drawn as tapered polygons (sharp edges) in `public/game/renderer.js` instead of stroked lines; keep this in mind if changing trail caps or widths.
- Board portraits render in greyscale when the beat action is `DamageIcon`/`knockbackIcon`; keep the renderer's action tag matching server output.
- Timeline playback base state should come from the last calculated beat entry at/ before the selected beat; do not fall back to uncalculated entries or `public.characters` or scrubbing will drift.
- Damage previews during hit shakes are drawn via `displayDamage` using pre-step damage to avoid double-counting when the step completes.
- Map panning/zooming is bound to the game area and must ignore UI elements like action cards, slots, or rotation controls; update `PAN_BLOCK_SELECTORS` in `public/game/controls.js` when adding new HUD controls.
- Find Game is disabled until a deck is selected; the selected deck ID is stored in cookies and its `characterId` plus movement/ability lists are sent with `/api/v1/lobby/join`.
- `/api/v1/lobby/join` rejects decks unless they contain exactly 4 movement cards and exactly 12 ability cards; keep `public/cards/cards.json` base decks and deck-builder output aligned with this.
- Base deck definitions from `public/cards/cards.json` are merged into each user's localStorage on load in `public/deckStore.js`; keep the merge logic when adding new base decks.

## PR expectations
- Summarize rule/engine changes clearly; include replay determinism notes when relevant.
- Include tests for new behaviors and note coverage in the PR description.

# Wrap up
When the user says "let's wrap this up" or something along those lines, execute the following steps:
- Refactor the most recently written code as necessary to make sure these methods are properly abstracted, encapsulated, built in extensible ways, and use the proper separations of controls/views/states on the front end UI. 
- Add/remove/update the gotchas into the AGENTS.md file graph so that we don't run into similar errors in the future. 
- Update the AGENTS.md file with any other relevant information to better understand the codebase. 
- Add any required tests (if needed).
- Update the Documentation map files as needed. 
