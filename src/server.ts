import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { readFile } from 'fs';
import { randomUUID } from 'crypto';
import { createLobbyStore } from './state/lobby';
import { ActionSetItem, CharacterId, GameDoc, LobbySnapshot, MatchDoc, QueueName, UserDoc } from './types';
import { MemoryDb } from './persistence/memoryDb';
import { CHARACTER_IDS } from './game/characters';
import { createInitialGameState } from './game/state';
import { applyActionSetToBeats } from './game/actionSets';
import { executeBeats } from './game/execute';
import {
  getCharacterFirstEIndex,
  getCharactersAtEarliestE,
  getTimelineEarliestEIndex,
  isCharacterAtEarliestE,
} from './game/beatTimeline';
import { DeckDefinition, loadCardCatalog } from './game/cardCatalog';
import {
  applyPendingUse,
  buildDefaultDeckDefinition,
  createDeckState,
  isActionValidationFailure,
  parseDeckDefinition,
  resolvePendingRefreshes,
  validateActionSubmission,
  PlayerDeckState,
} from './game/cardRules';

interface EventPacket {
  type: string;
  payload?: unknown;
}

interface PendingActionBatch {
  beatIndex: number;
  requiredUserIds: string[];
  submitted: Map<string, ActionSetItem[]>;
}

export function buildServer(port: number) {
  const lobby = createLobbyStore();
  const db = new MemoryDb();
  const sseClients = new Map<string, ServerResponse>();
  const pendingActionSets = new Map<string, PendingActionBatch>();
  const pendingInvites = new Map<string, { from: string; to: string; createdAt: Date }>();
  const matchDisconnects = new Map<string, Set<string>>();
  const queuedDecks = new Map<string, DeckDefinition>();
  const gameDeckStates = new Map<string, Map<string, PlayerDeckState>>();
  const winsRequired = 3;
  let anonymousCounter = 0;

  const pickRandomCharacterId = () => CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];
  const nextAnonymousName = () => {
    anonymousCounter += 1;
    return `Anonymous${anonymousCounter}`;
  };

  const normalizeCharacterId = (value: unknown): CharacterId | undefined => {
    if (typeof value !== 'string') return undefined;
    const candidate = value.trim().toLowerCase();
    if (!candidate) return undefined;
    return CHARACTER_IDS.includes(candidate as CharacterId) ? (candidate as CharacterId) : undefined;
  };

  const sendEvent = (packet: EventPacket, targetId?: string) => {
    const entries: Array<[string, ServerResponse | undefined]> = targetId
      ? [[targetId, sseClients.get(targetId)]]
      : Array.from(sseClients.entries());
    entries.forEach(([id, res]) => {
      if (!res) return;
      res.write(`data: ${JSON.stringify({ ...packet, recipient: id })}\n\n`);
    });
  };

  lobby.events.on('queueChanged', (state: LobbySnapshot) => {
    sendEvent({ type: 'queueChanged', payload: state });
  });

  const parseBody = async (req: IncomingMessage): Promise<any> => {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  const respondJson = (res: ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
  };

  const notFound = (res: ServerResponse) => respondJson(res, 404, { error: 'Not found' });

  const buildDeckStatesForMatch = async (match: MatchDoc, game: GameDoc) => {
    const catalog = await loadCardCatalog();
    const deckStates = new Map<string, PlayerDeckState>();
    match.players.forEach((player) => {
      const queued = queuedDecks.get(player.userId);
      const deck = queued ?? buildDefaultDeckDefinition(catalog);
      deckStates.set(player.userId, createDeckState(deck));
      queuedDecks.delete(player.userId);
    });
    gameDeckStates.set(game.id, deckStates);
    return deckStates;
  };

  const ensureDeckStatesForGame = async (game: GameDoc, match?: MatchDoc) => {
    const existing = gameDeckStates.get(game.id);
    if (existing) return existing;
    if (match) {
      return buildDeckStatesForMatch(match, game);
    }
    const catalog = await loadCardCatalog();
    const deckStates = new Map<string, PlayerDeckState>();
    const characters = game.state?.public?.characters ?? [];
    characters.forEach((character) => {
      deckStates.set(character.userId, createDeckState(buildDefaultDeckDefinition(catalog)));
    });
    gameDeckStates.set(game.id, deckStates);
    return deckStates;
  };

  const getPresenceSnapshot = async () => {
    const snapshot = lobby.serialize();
    const connectedIds = Array.from(sseClients.keys());
    const connectedUsers = await Promise.all(
      connectedIds.map(async (userId) => {
        const user = await upsertUserFromRequest(userId);
        return { userId, username: user.username };
      }),
    );
    return {
      connected: connectedUsers,
      quickplayQueue: [...snapshot.quickplayQueue],
      inGame: [...snapshot.inGame],
    };
  };

  const upsertUserFromRequest = async (
    userId?: string,
    username?: string,
    characterId?: CharacterId,
  ): Promise<UserDoc> => {
    if (userId) {
      const existing = await db.findUser(userId);
      if (existing) {
        const nextUsername = username && existing.username !== username ? username : existing.username;
        const nextCharacterId = characterId ?? existing.characterId;
        if (nextUsername !== existing.username || nextCharacterId !== existing.characterId) {
          return db.upsertUser({
            id: userId,
            username: nextUsername,
            characterId: nextCharacterId,
            elo: existing.elo,
          });
        }
        return existing;
      }
    }
    return db.upsertUser({
      id: userId,
      username: username || nextAnonymousName(),
      elo: 1000,
      characterId,
    });
  };

  const ensureUserCharacter = async (user: UserDoc): Promise<UserDoc> => {
    if (user.characterId) return user;
    const forcedCharacter =
      user.username === 'Anonymous1' ? 'murelious' : user.username === 'Anonymous2' ? 'monkey-queen' : null;
    return db.upsertUser({
      id: user.id,
      username: user.username,
      characterId: forcedCharacter ?? pickRandomCharacterId(),
    });
  };

  const formatGameLog = (game: GameDoc, match?: MatchDoc) => {
    const usernameById = new Map<string, string>();
    match?.players.forEach((player) => {
      usernameById.set(player.userId, player.username);
    });
    const characters = game.state?.public?.characters ?? [];
    const beats = game.state?.public?.beats ?? [];
    const lines = ['[game:update] Player locations:'];
    if (!characters.length) {
      lines.push('- (none)');
    } else {
      characters.forEach((character) => {
        const name = usernameById.get(character.userId) ?? character.userId;
        const characterLabel = character.characterName ?? character.characterId ?? 'unknown';
        const position = character.position ? `q=${character.position.q} r=${character.position.r}` : 'unknown position';
        const facing = Number.isFinite(character.facing) ? ` facing=${character.facing}` : '';
        lines.push(`- ${name} [${characterLabel}]: ${position}${facing}`);
      });
    }
    lines.push('[game:update] Beats:');
    lines.push(JSON.stringify(beats, null, 2));
    return lines.join('\n');
  };

  const logGameState = (game: GameDoc, match?: MatchDoc) => {
    console.log(formatGameLog(game, match));
  };

  const sendGameUpdate = (match: MatchDoc | undefined, game: GameDoc) => {
    if (!match) return;
    match.players.forEach((player) => {
      sendEvent({ type: 'game:update', payload: game }, player.userId);
    });
  };

  const handleJoin = async (body: any) => {
    const characterId = normalizeCharacterId(body.characterId || body.characterID);
    const user = await upsertUserFromRequest(body.userId, body.username, characterId);
    const assignedUser = await ensureUserCharacter(user);
    if (body.deck) {
      const catalog = await loadCardCatalog();
      const parsed = parseDeckDefinition(body.deck, catalog);
      if (!parsed.deck || parsed.errors.length) {
        const detail = parsed.errors.map((error) => error.message).join(' ');
        throw new Error(detail || 'Invalid deck payload');
      }
      if (parsed.deck.movement.length !== 4 || parsed.deck.ability.length !== 12) {
        throw new Error('Deck must include 4 movement cards and 12 ability cards.');
      }
      queuedDecks.set(assignedUser.id, parsed.deck);
    } else {
      queuedDecks.delete(assignedUser.id);
    }
    const queue: QueueName = body.queue || 'quickplayQueue';
    lobby.addToQueue(assignedUser.id, queue);
    if (queue === 'quickplayQueue') {
      console.log(`[lobby] ${assignedUser.username} (${assignedUser.id}) joined quickplay queue`);
    }
    return { user: assignedUser, lobby: lobby.serialize() };
  };

  const handleLeave = async (body: any) => {
    if (body.userId) {
      lobby.removeFromQueue(body.userId, body.queue as QueueName | undefined);
      queuedDecks.delete(body.userId);
    }
    return { lobby: lobby.serialize() };
  };

  const createSkeletonGame = async (match: MatchDoc): Promise<GameDoc> => {
    return db.createGame({
      matchId: match.id,
      players: match.players.map((player, index) => ({
        userId: player.userId,
        ready: true,
        turn: index === 0,
      })),
      timers: { turnSeconds: 60, incrementSeconds: 0 },
      outcome: undefined,
      state: await createInitialGameState(
        match.players.map((player) => ({
          userId: player.userId,
          username: player.username,
          characterId: player.characterId,
        })),
      ),
    });
  };

  const notifyMatchPlayers = (match: MatchDoc, game: GameDoc) => {
    logGameState(game, match);
    match.players.forEach((player) => {
      sendEvent({ type: 'match:created', payload: match }, player.userId);
      sendEvent({ type: 'game:update', payload: game }, player.userId);
    });
  };

  const createMatchWithUsers = async (users: Array<{ id: string; username?: string }>) => {
    const resolved = await Promise.all(users.map((user) => upsertUserFromRequest(user.id, user.username)));
    const withCharacters = await Promise.all(resolved.map((user) => ensureUserCharacter(user)));
    lobby.markInGame(withCharacters.map((user) => user.id));
    const match = await db.createMatch({
      players: withCharacters.map((user) => ({
        userId: user.id,
        username: user.username,
        score: 0,
        eloChange: 0,
        characterId: user.characterId ?? pickRandomCharacterId(),
      })),
      gameId: '',
      winsRequired,
      state: 'in-progress',
      winnerId: undefined,
      completedAt: undefined,
    });
    const game = await createSkeletonGame(match);
    const updatedMatch = await db.updateMatch(match.id, { gameId: game.id });
    const finalMatch = updatedMatch ?? match;
    await buildDeckStatesForMatch(finalMatch, game);
    notifyMatchPlayers(finalMatch, game);
    return { match: finalMatch, game };
  };

  const createCustomMatch = async (body: any) => {
    return createMatchWithUsers([
      { id: body.hostId, username: body.hostName || body.hostId },
      { id: body.guestId, username: body.guestName || body.guestId },
    ]);
  };

  const launchBotIfNeeded = async () => {
    const snapshot = lobby.serialize();
    const botCandidate = snapshot.botQueue[0];
    if (!botCandidate) return;
    lobby.removeFromQueue(botCandidate, 'botQueue');
    const bot = await db.upsertUser({ username: 'Bot', isBot: true, botDifficulty: 'easy' });
    await createCustomMatch({ hostId: botCandidate, guestId: bot.id, guestName: bot.username });
  };

  let matchmakeInProgress = false;
  const matchmakeQuickplay = async () => {
    if (matchmakeInProgress) return;
    matchmakeInProgress = true;
    try {
      let snapshot = lobby.serialize();
      while (snapshot.quickplayQueue.length >= 2) {
        const [first, second] = snapshot.quickplayQueue;
        if (!first || !second) break;
        await createMatchWithUsers([{ id: first }, { id: second }]);
        snapshot = lobby.serialize();
      }
    } finally {
      matchmakeInProgress = false;
    }
  };

  const sendActiveMatchState = async (userId: string) => {
    const match = await db.findActiveMatchByUser(userId);
    if (!match) return;
    sendEvent({ type: 'match:created', payload: match }, userId);
    if (match.gameId) {
      const game = await db.findGame(match.gameId);
      if (game) {
        logGameState(game, match);
        sendEvent({ type: 'game:update', payload: game }, userId);
      }
    }
  };

  const completeMatch = async (matchId: string, body: any) => {
    const match = await db.updateMatch(matchId, {
      state: 'complete',
      winnerId: body.winnerId,
      completedAt: new Date(),
    });
    if (!match) return undefined;
    const winner = match.players.find((p) => p.userId === body.winnerId);
    if (winner) {
      const delta = 15;
      match.players.forEach((player) => {
        const change = player.userId === winner.userId ? delta : -delta;
        player.eloChange = change;
      });
      for (const player of match.players) {
        const user = await db.findUser(player.userId);
        if (user) {
          user.elo += player.eloChange;
          user.updatedAt = new Date();
        }
      }
    }
    match.players.forEach((player) => lobby.removeFromQueue(player.userId));
    sendEvent({ type: 'match:ended', payload: match });
    if (match.gameId) {
      gameDeckStates.delete(match.gameId);
    }
    return match;
  };

  const serveEvents = async (req: IncomingMessage, res: ServerResponse) => {
    const { query } = parse(req.url || '', true);
    const userId = (query.userId as string) || randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    const user = await upsertUserFromRequest(userId);
    res.write(`data: ${JSON.stringify({ type: 'connected', payload: { userId, username: user.username, lobby: lobby.serialize() } })}\n\n`);
    sseClients.set(userId, res);
    pendingInvites.delete(userId);
    void sendActiveMatchState(userId);

    req.on('close', () => {
      sseClients.delete(userId);
      matchDisconnects.forEach((set) => set.delete(userId));
    });
  };

  const handleStatic = (res: ServerResponse, path: string) => {
    const resolved =
      path === '/'
        ? '/public/index.html'
        : path === '/admin' || path === '/admin/'
          ? '/public/admin.html'
          : path === '/cards' || path === '/cards/'
            ? '/public/cards.html'
            : path.startsWith('/public/')
              ? path
              : `/public${path}`;
    readFile(process.cwd() + resolved, (err, data) => {
      if (err) {
        notFound(res);
      } else {
        let type = 'text/plain';
        if (resolved.endsWith('.html')) type = 'text/html';
        if (resolved.endsWith('.css')) type = 'text/css';
        if (resolved.endsWith('.js') || resolved.endsWith('.mjs')) type = 'text/javascript';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      }
    });
  };

  const server = createServer(async (req, res) => {
    const { pathname } = parse(req.url || '', true);
    if (!pathname) return notFound(res);

    if (req.method === 'GET' && pathname === '/events') {
      return serveEvents(req, res);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (pathname.startsWith('/api/v1/lobby')) {
      if (req.method === 'GET' && pathname === '/api/v1/lobby/state') {
        return respondJson(res, 200, lobby.serialize());
      }
      if (req.method === 'GET' && pathname === '/api/v1/lobby/admin') {
        return respondJson(res, 200, await getPresenceSnapshot());
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/join') {
        try {
          const body = await parseBody(req);
          const result = await handleJoin(body);
          return respondJson(res, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid join payload';
          return respondJson(res, 400, { error: message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/leave') {
        const body = await parseBody(req);
        const result = await handleLeave(body);
        return respondJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/clear') {
        lobby.clearQueues();
        queuedDecks.clear();
        return respondJson(res, 200, lobby.serialize());
      }
    }

    if (pathname.startsWith('/api/v1/match')) {
      if (req.method === 'POST' && pathname === '/api/v1/match/custom') {
        const body = await parseBody(req);
        const result = await createCustomMatch(body);
        return respondJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname.startsWith('/api/v1/match/') && pathname.endsWith('/end')) {
        const matchId = pathname.split('/')[4];
        const body = await parseBody(req);
        const match = await completeMatch(matchId, body);
        if (!match) return notFound(res);
        return respondJson(res, 200, match);
      }
    }

    if (pathname.startsWith('/api/v1/game')) {
      if (req.method === 'POST' && pathname === '/api/v1/game/action-set') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid action set payload' });
        }
        const userId = body.userId || body.userID;
        const gameId = body.gameId || body.gameID;
        const activeCardId = body.activeCardId || body.activeCardID;
        const passiveCardId = body.passiveCardId || body.passiveCardID;
        const rotation = body.rotation ?? body.rotationLabel;
        if (!userId || !gameId) {
          return respondJson(res, 400, { error: 'Invalid action set payload' });
        }
        const game = await db.findGame(gameId);
        if (!game) return notFound(res);
        const characters = game.state?.public?.characters ?? [];
        const isPlayer = game.players.some((player) => player.userId === userId);
        const hasCharacter = characters.some((character) => character.userId === userId);
        if (!isPlayer || !hasCharacter) {
          return respondJson(res, 403, { error: 'User not in game' });
        }
        const beats = game.state?.public?.beats ?? [];
        const character = characters.find((candidate) => candidate.userId === userId);
        if (!isCharacterAtEarliestE(beats, characters, character)) {
          return respondJson(res, 409, { error: 'Action set rejected: player is behind the earliest timeline beat' });
        }
        const earliestIndex = getTimelineEarliestEIndex(beats, characters);
        const atBatCharacters = getCharactersAtEarliestE(beats, characters);
        const atBatUserIds = atBatCharacters.map((candidate) => candidate.userId);
        const match = await db.findMatch(game.matchId);
        const catalog = await loadCardCatalog();
        const deckStates = await ensureDeckStatesForGame(game, match);
        const land = game.state?.public?.land ?? [];
        resolvePendingRefreshes(deckStates, beats, characters, land);
        const deckState = deckStates.get(userId);
        if (!deckState) {
          return respondJson(res, 500, { error: 'Missing deck state for player' });
        }

        if (atBatUserIds.length <= 1) {
          const validation = validateActionSubmission(
            { activeCardId, passiveCardId, rotation },
            deckState,
            catalog,
          );
          if (isActionValidationFailure(validation)) {
            return respondJson(res, 400, { error: validation.error.message, code: validation.error.code });
          }
          const firstEIndex = getCharacterFirstEIndex(beats, character);
          const pendingResult = applyPendingUse(deckState, {
            beatIndex: firstEIndex + validation.refreshOffset,
            movementCardId: validation.movementCardId,
            abilityCardId: validation.abilityCardId,
          });
          if (!pendingResult.ok && pendingResult.error) {
            return respondJson(res, 409, { error: pendingResult.error.message, code: pendingResult.error.code });
          }
          pendingActionSets.delete(game.id);
          game.state.public.pendingActions = undefined;
          const updatedBeats = applyActionSetToBeats(beats, characters, userId, validation.actionList);
          const executed = executeBeats(updatedBeats, characters);
          game.state.public.beats = executed.beats;
          game.state.public.characters = executed.characters;
          resolvePendingRefreshes(deckStates, executed.beats, executed.characters, land);
          const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
          sendGameUpdate(match, updatedGame);
          return respondJson(res, 200, updatedGame);
        }

        let batch = pendingActionSets.get(game.id);
        if (!batch || batch.beatIndex !== earliestIndex) {
          batch = { beatIndex: earliestIndex, requiredUserIds: atBatUserIds, submitted: new Map() };
          pendingActionSets.set(game.id, batch);
        }

        if (!batch.requiredUserIds.includes(userId)) {
          return respondJson(res, 409, { error: 'Action set rejected: player is not required for current beat' });
        }
        if (batch.submitted.has(userId)) {
          return respondJson(res, 409, { error: 'Action set already submitted for this beat' });
        }

        const validation = validateActionSubmission(
          { activeCardId, passiveCardId, rotation },
          deckState,
          catalog,
        );
        if (isActionValidationFailure(validation)) {
          return respondJson(res, 400, { error: validation.error.message, code: validation.error.code });
        }
        const firstEIndex = getCharacterFirstEIndex(beats, character);
        const pendingResult = applyPendingUse(deckState, {
          beatIndex: firstEIndex + validation.refreshOffset,
          movementCardId: validation.movementCardId,
          abilityCardId: validation.abilityCardId,
        });
        if (!pendingResult.ok && pendingResult.error) {
          return respondJson(res, 409, { error: pendingResult.error.message, code: pendingResult.error.code });
        }
        batch.submitted.set(userId, validation.actionList);
        game.state.public.pendingActions = {
          beatIndex: batch.beatIndex,
          requiredUserIds: [...batch.requiredUserIds],
          submittedUserIds: Array.from(batch.submitted.keys()),
        };

        const pendingGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
        sendGameUpdate(match, pendingGame);

        if (batch.submitted.size < batch.requiredUserIds.length) {
          return respondJson(res, 200, pendingGame);
        }

        let updatedBeats = beats;
        batch.requiredUserIds.forEach((requiredId) => {
          const list = batch?.submitted.get(requiredId);
          if (list) {
            updatedBeats = applyActionSetToBeats(updatedBeats, characters, requiredId, list);
          }
        });
        const executed = executeBeats(updatedBeats, characters);
        game.state.public.beats = executed.beats;
        game.state.public.characters = executed.characters;
        resolvePendingRefreshes(deckStates, executed.beats, executed.characters, land);
        game.state.public.pendingActions = undefined;
        pendingActionSets.delete(game.id);
        const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
        sendGameUpdate(match, updatedGame);
        return respondJson(res, 200, updatedGame);
      }
    }

    if (pathname.startsWith('/api/v1/history')) {
      if (req.method === 'GET' && pathname === '/api/v1/history/matches') {
        return respondJson(res, 200, await db.listMatches());
      }
      if (req.method === 'GET' && pathname === '/api/v1/history/games') {
        return respondJson(res, 200, await db.listGames());
      }
    }

    if (
      pathname === '/' ||
      pathname === '/admin' ||
      pathname === '/admin/' ||
      pathname === '/cards' ||
      pathname === '/cards/' ||
      pathname.startsWith('/public')
    ) {
      return handleStatic(res, pathname);
    }

    return notFound(res);
  });

  server.listen(port, () => {
    lobby.clearQueues();
    sendEvent({ type: 'queueChanged', payload: lobby.serialize() });
    setInterval(() => {
      launchBotIfNeeded();
    }, 5000);
    setInterval(() => {
      void matchmakeQuickplay();
    }, 2000);
  });

  return server;
}
