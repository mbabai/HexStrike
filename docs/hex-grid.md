# Hex Grid Coordinates

HexStrike uses axial coordinates `(q, r)` with a pointy-top layout. The origin `(0, 0)` is the center of the infinite grid. Distances and neighbors follow the axial coordinate system with cube coordinate `s = -q - r`.

The game state stores a `public` and `secret` state object:
- `public` is intended for values that all players (and eventually spectators) can see.
- `secret` is reserved for hidden information (per-player hands, hidden decks, etc.).

## Land vs. abyss

The board is infinite. Only hexes listed in `public.land` are "land" tiles. Every other coordinate is "abyss" by default. The current lobby prototype uses a compact land island centered on `(0, 0)` and rotated sideways relative to the reference art.

The source of truth for the coordinate system and land layout lives in `public/shared/hex.mjs`, which is loaded by both the server and client.
