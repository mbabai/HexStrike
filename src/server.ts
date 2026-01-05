import { createServer } from 'http';
import { parse } from 'url';
import { readFile } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { createLobbyStore } from './state/lobby';
import { MemoryDb } from './persistence/memoryDb';
import { CHARACTER_IDS } from './game/characters';
import { createInitialGameState } from './game/state';
import { applyActionSetToBeats } from './game/actionSets';
import { executeBeatsWithInteractions } from './game/execute';
import { applyDeathToBeats, evaluateMatchOutcome } from './game/matchEndRules';
import {
  getCharacterFirstEIndex,
  getCharactersAtEarliestE,
  getTimelineEarliestEIndex,
  isCharacterAtEarliestE,
} from './game/beatTimeline';
import { loadCardCatalog } from './game/cardCatalog';
import {
  applyCardUse,
  buildDefaultDeckDefinition,
  buildPlayerCardState,
  createDeckState,
  isActionValidationFailure,
  parseDeckDefinition,
  resolveLandRefreshes,
  validateActionSubmission,
} from './game/cardRules';
import {
  ActionListItem,
  BeatEntry,
  CardCatalog,
  CharacterId,
  DeckDefinition,
  DeckState,
  GameDoc,
  MatchDoc,
  PublicCharacter,
  QueueName,
} from './types';

interface PendingActionBatch {
  beatIndex: number;
  requiredUserIds: string[];
  submitted: Map<string, { actionList: ActionListItem[]; play: unknown[] }>;
}

interface WsClient {
  id: string;
  userId: string;
  socket: any;
  buffer: Buffer;
}

interface ActionSetResponse {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
  code?: string;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOG_PREFIX = '[hexstrike]';
const COMBO_ACTION = 'CO';

const normalizeActionLabel = (value: unknown): string => {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isComboAction = (value: unknown): boolean => normalizeActionLabel(value).toUpperCase() === COMBO_ACTION;

const cardHasCombo = (card: { actions?: unknown[] } | undefined | null): boolean =>
  Array.isArray(card?.actions) && card.actions.some((action) => isComboAction(action));

const buildComboAvailability = (deckStates: Map<string, DeckState>, catalog: CardCatalog) => {
  const availability = new Map<string, boolean>();
  deckStates.forEach((deckState, userId) => {
    const movementAvailable = deckState.movement.filter((id) => !deckState.exhaustedMovementIds.has(id));
    const abilityAvailable = deckState.abilityHand.slice();
    const hasCombo = [...movementAvailable, ...abilityAvailable].some((id) => cardHasCombo(catalog.cardsById.get(id)));
    availability.set(userId, hasCombo);
  });
  return availability;
};

const findComboContinuation = (
  interactions: Array<{
    id?: string;
    type?: string;
    status?: string;
    actorUserId?: string;
    beatIndex?: number;
    resolution?: { continue?: boolean };
  }>,
  userId: string,
  beatIndex: number,
) =>
  interactions.find(
    (interaction) =>
      interaction?.type === 'combo' &&
      interaction?.status === 'resolved' &&
      interaction?.actorUserId === userId &&
      interaction?.beatIndex === beatIndex &&
      Boolean((interaction as { resolution?: { continue?: boolean } }).resolution?.continue),
  ) ?? null;

const withComboStarter = (actionList: ActionListItem[]) =>
  actionList.map((item, index) => (index === 0 ? { ...item, comboStarter: true } : { ...item }));

const getEntryForCharacter = (beat: BeatEntry[] | undefined, character: { userId: string; username?: string }) => {
  if (!Array.isArray(beat)) return undefined;
  return beat.find((entry) => {
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.userId || key === character.username;
  });
};

const buildTimelineSummary = (beats: BeatEntry[][], characters: PublicCharacter[]) => {
  const perCharacter = characters.map((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    let lastNonE = -1;
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const entry = getEntryForCharacter(beats[i], character);
      if (entry && entry.action !== 'E') {
        lastNonE = i;
        break;
      }
    }
    return {
      userId: character.userId,
      username: character.username,
      firstE,
      lastNonE,
    };
  });

  let trailingAllE = 0;
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    const isAllE = characters.every((character) => {
      const entry = getEntryForCharacter(beats[i], character);
      if (!entry) return true;
      return entry.action === 'E';
    });
    if (!isAllE) break;
    trailingAllE += 1;
  }

  return {
    length: beats.length,
    trailingAllE,
    perCharacter,
  };
};

export function buildServer(port: number) {
  const lobby = createLobbyStore();
  const db = new MemoryDb();
  const sseClients = new Map<string, any>();
  const wsClients = new Map<string, WsClient>();
  const pendingActionSets = new Map<string, PendingActionBatch>();
  const pendingInvites = new Map<string, string>();
  const matchDisconnects = new Map<string, Set<string>>();
  const matchExitUsers = new Map<string, Set<string>>();
  const queuedDecks = new Map<string, DeckDefinition>();
  const gameDeckStates = new Map<string, Map<string, DeckState>>();
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

  const sendSseEvent = (packet: Record<string, unknown>, targetId?: string) => {
    const entries = targetId
      ? [[targetId, sseClients.get(targetId)]]
      : Array.from(sseClients.entries());
    entries.forEach(([id, res]) => {
      if (!res) return;
      res.write(`data: ${JSON.stringify({ ...packet, recipient: id })}\n\n`);
    });
  };

  const buildWsAccept = (key: string) => createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');

  const encodeWsMessage = (message: string): Buffer => {
    const payload = Buffer.from(message);
    const length = payload.length;
    if (length < 126) {
      const header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
      return Buffer.concat([header, payload]);
    }
    if (length < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
      return Buffer.concat([header, payload]);
    }
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
    return Buffer.concat([header, payload]);
  };

  const decodeWsMessages = (buffer: Buffer) => {
    let offset = 0;
    const messages: string[] = [];
    while (offset + 2 <= buffer.length) {
      const first = buffer.readUInt8(offset);
      const second = buffer.readUInt8(offset + 1);
      const opcode = first & 0x0f;
      let payloadLength = second & 0x7f;
      const masked = (second & 0x80) !== 0;
      let headerLength = 2;
      if (payloadLength === 126) {
        if (offset + 4 > buffer.length) break;
        payloadLength = buffer.readUInt16BE(offset + 2);
        headerLength = 4;
      } else if (payloadLength === 127) {
        if (offset + 10 > buffer.length) break;
        payloadLength = buffer.readUInt32BE(offset + 6);
        headerLength = 10;
      }
      const maskOffset = masked ? headerLength : 0;
      if (masked && offset + headerLength + 4 > buffer.length) break;
      const payloadOffset = offset + headerLength + maskOffset;
      if (payloadOffset + payloadLength > buffer.length) break;
      const payload = buffer.slice(payloadOffset, payloadOffset + payloadLength);
      if (masked) {
        const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }
      if (opcode === 1) {
        messages.push(payload.toString('utf8'));
      }
      if (opcode === 8) {
        break;
      }
      offset = payloadOffset + payloadLength;
    }
    return { messages, remaining: buffer.slice(offset) };
  };

  const sendWsMessage = (socket: any, message: string) => {
    if (!socket) return;
    socket.write(encodeWsMessage(message));
  };

  const sendWsEvent = (packet: Record<string, unknown>, targetId?: string) => {
    const entries = targetId
      ? Array.from(wsClients.values()).filter((client) => client.userId === targetId)
      : Array.from(wsClients.values());
    entries.forEach((client) => {
      sendWsMessage(client.socket, JSON.stringify({ ...packet, recipient: targetId ?? client.userId }));
    });
  };

  const sendRealtimeEvent = (packet: Record<string, unknown>, targetId?: string) => {
    sendSseEvent(packet, targetId);
    sendWsEvent(packet, targetId);
  };

  lobby.events.on('queueChanged', (state) => {
    sendRealtimeEvent({ type: 'queueChanged', payload: state });
  });

  const parseBody = async (req: any) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: string) => {
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

  const respondJson = (res: any, status: number, payload: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
  };

  const notFound = (res: any) => respondJson(res, 404, { error: 'Not found' });
  const buildDeckStatesForMatch = async (match: MatchDoc, game: GameDoc) => {
    const catalog = await loadCardCatalog();
    const deckStates = new Map<string, DeckState>();
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
    const deckStates = new Map<string, DeckState>();
    const characters = game.state?.public?.characters ?? [];
    characters.forEach((character) => {
      deckStates.set(character.userId, createDeckState(buildDefaultDeckDefinition(catalog)));
    });
    gameDeckStates.set(game.id, deckStates);
    return deckStates;
  };

  const buildGameViewForPlayer = (game: GameDoc, userId: string, deckStates?: Map<string, DeckState>) => {
    const resolvedDeckStates = deckStates ?? gameDeckStates.get(game.id);
    const playerDeckState = resolvedDeckStates?.get(userId) ?? null;
    const playerCards = playerDeckState ? buildPlayerCardState(playerDeckState) : null;
    const publicState = game.state.public;
    const beats = publicState.beats ?? publicState.timeline ?? [];
    return {
      ...game,
      state: {
        public: {
          ...publicState,
          beats,
          timeline: beats,
        },
        secret: game.state.secret,
        player: { cards: playerCards },
      },
    };
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

  const upsertUserFromRequest = async (userId?: string, username?: string, characterId?: CharacterId) => {
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

  const ensureUserCharacter = async (user: { id: string; username: string; characterId?: CharacterId }) => {
    if (user.characterId) return user;
    const forcedCharacter =
      user.username === 'Anonymous1'
        ? ('murelious' as CharacterId)
        : user.username === 'Anonymous2'
          ? ('monkey-queen' as CharacterId)
          : null;
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
    lines.push('[game:update] Timeline:');
    lines.push(JSON.stringify(beats, null, 2));
    return lines.join('\n');
  };

  const logGameState = (game: GameDoc, match?: MatchDoc) => {
    console.log(formatGameLog(game, match));
  };

  const sendInputRequests = (match: MatchDoc | undefined, game: GameDoc) => {
    if (!match) return;
    const publicState = game.state.public;
    if (publicState.matchOutcome) return;
    const pending = publicState.pendingActions;
    const interactions = publicState.customInteractions ?? [];
    const pendingInteraction = interactions.find((interaction) => interaction.status === 'pending');
    if (pendingInteraction) {
      const payload = {
        gameId: game.id,
        beatIndex: pendingInteraction.beatIndex,
        requiredUserIds: [pendingInteraction.actorUserId],
        interactionId: pendingInteraction.id,
      };
      sendRealtimeEvent({ type: 'input:request', payload }, pendingInteraction.actorUserId);
      return;
    }
    if (pending) {
      const submitted = new Set(pending.submittedUserIds ?? []);
      pending.requiredUserIds.forEach((userId) => {
        if (!submitted.has(userId)) {
          sendRealtimeEvent({ type: 'input:request', payload: { ...pending, gameId: game.id } }, userId);
        }
      });
      return;
    }
    const beats = publicState.beats ?? publicState.timeline ?? [];
    const characters = publicState.characters ?? [];
    const earliestIndex = getTimelineEarliestEIndex(beats, characters);
    const atBatCharacters = getCharactersAtEarliestE(beats, characters);
    const requiredUserIds = Array.from(new Set(atBatCharacters.map((candidate) => candidate.userId).filter(Boolean)));
    if (!requiredUserIds.length) return;
    requiredUserIds.forEach((userId) => {
      sendRealtimeEvent(
        { type: 'input:request', payload: { gameId: game.id, beatIndex: earliestIndex, requiredUserIds } },
        userId,
      );
    });
  };

  const sendGameUpdate = (match: MatchDoc | undefined, game: GameDoc, deckStates?: Map<string, DeckState>) => {
    if (!match) return;
    const exited = matchExitUsers.get(game.id);
    match.players.forEach((player) => {
      if (exited?.has(player.userId)) return;
      const view = buildGameViewForPlayer(game, player.userId, deckStates);
      sendRealtimeEvent({ type: 'game:update', payload: view }, player.userId);
    });
    sendInputRequests(match, game);
  };

  const applyMatchOutcome = (game: GameDoc, deckStates?: Map<string, DeckState>) => {
    if (game.state.public.matchOutcome) return false;
    const beats = game.state.public.beats ?? game.state.public.timeline ?? [];
    const characters = game.state.public.characters ?? [];
    const land = game.state.public.land ?? [];
    const resolvedDeckStates = deckStates ?? gameDeckStates.get(game.id);
    if (!resolvedDeckStates) return false;
    const outcome = evaluateMatchOutcome(beats, characters, resolvedDeckStates, land);
    if (!outcome) return false;
    if (outcome.reason === 'far-from-land') {
      applyDeathToBeats(beats, characters, outcome.loserUserId, outcome.beatIndex, land);
      game.state.public.timeline = beats;
      game.state.public.beats = beats;
    }
    game.state.public.matchOutcome = outcome;
    return true;
  };
  const handleJoin = async (body: Record<string, unknown>) => {
    const characterId = normalizeCharacterId(body.characterId || body.characterID);
    const user = await upsertUserFromRequest(body.userId as string, body.username as string, characterId);
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
    const queue = (body.queue as QueueName) || 'quickplayQueue';
    lobby.addToQueue(assignedUser.id, queue);
    if (queue === 'quickplayQueue') {
      console.log(`[lobby] ${assignedUser.username} (${assignedUser.id}) joined quickplay queue`);
    }
    return { user: assignedUser, lobby: lobby.serialize() };
  };

  const handleLeave = async (body: Record<string, unknown>) => {
    if (body.userId) {
      lobby.removeFromQueue(body.userId as string, body.queue as any);
      queuedDecks.delete(body.userId as string);
    }
    return { lobby: lobby.serialize() };
  };

  const createSkeletonGame = async (match: MatchDoc) =>
    db.createGame({
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

  const notifyMatchPlayers = (match: MatchDoc, game: GameDoc) => {
    logGameState(game, match);
    const deckStates = gameDeckStates.get(game.id);
    match.players.forEach((player) => {
      sendRealtimeEvent({ type: 'match:created', payload: match }, player.userId);
      const view = buildGameViewForPlayer(game, player.userId, deckStates);
      sendRealtimeEvent({ type: 'game:update', payload: view }, player.userId);
    });
    sendInputRequests(match, game);
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
        characterId: (user.characterId ?? pickRandomCharacterId()) as CharacterId,
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

  const createCustomMatch = async (body: Record<string, unknown>) =>
    createMatchWithUsers([
      { id: body.hostId as string, username: (body.hostName as string) || (body.hostId as string) },
      { id: body.guestId as string, username: (body.guestName as string) || (body.guestId as string) },
    ]);

  const launchBotIfNeeded = async () => {
    const snapshot = lobby.serialize();
    const botCandidate = snapshot.botQueue[0];
    if (!botCandidate) return;
    lobby.removeFromQueue(botCandidate, 'botQueue');
    const bot = await db.upsertUser({ username: 'Bot', isBot: true, botDifficulty: 'easy' });
    await createCustomMatch({ hostId: botCandidate, guestId: bot.id, guestName: bot.username } as Record<
      string,
      unknown
    >);
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
    if (match.gameId) {
      const exited = matchExitUsers.get(match.gameId);
      if (exited?.has(userId)) return;
    }
    sendRealtimeEvent({ type: 'match:created', payload: match }, userId);
    if (match.gameId) {
      const game = await db.findGame(match.gameId);
      if (game) {
        const deckStates = await ensureDeckStatesForGame(game, match);
        logGameState(game, match);
        const view = buildGameViewForPlayer(game, userId, deckStates);
        sendRealtimeEvent({ type: 'game:update', payload: view }, userId);
      }
    }
  };

  const completeMatch = async (matchId: string, body: Record<string, unknown>) => {
    const match = await db.updateMatch(matchId, {
      state: 'complete',
      winnerId: body.winnerId as string,
      completedAt: new Date(),
    });
    if (!match) return undefined;
    const winner = match.players.find((player) => player.userId === body.winnerId);
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
    sendRealtimeEvent({ type: 'match:ended', payload: match });
    if (match.gameId) {
      gameDeckStates.delete(match.gameId);
      matchExitUsers.delete(match.gameId);
    }
    return match;
  };

  const serveEvents = async (req: any, res: any) => {
    const { query } = parse(req.url || '', true);
    const userId = (query?.userId as string) || randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    const user = await upsertUserFromRequest(userId);
    res.write(
      `data: ${JSON.stringify({ type: 'connected', payload: { userId, username: user.username, lobby: lobby.serialize() } })}\n\n`,
    );
    sseClients.set(userId, res);
    pendingInvites.delete(userId);
    void sendActiveMatchState(userId);
    req.on('close', () => {
      sseClients.delete(userId);
      matchDisconnects.forEach((set) => set.delete(userId));
    });
  };

  const handleStatic = (res: any, path: string) => {
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
  const submitActionSet = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    const activeCardId = (body.activeCardId as string) || (body.activeCardID as string);
    const passiveCardId = (body.passiveCardId as string) || (body.passiveCardID as string);
    const rotation = (body.rotation as string) ?? (body.rotationLabel as string);
    console.log(`${LOG_PREFIX} action:set request`, {
      userId,
      gameId,
      activeCardId,
      passiveCardId,
      rotation,
    });
    if (!userId || !gameId) {
      return { ok: false, status: 400, error: 'Invalid action set payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    if (game.state?.public?.matchOutcome) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'match-ended' });
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public?.characters ?? [];
    const isPlayer = game.players.some((player) => player.userId === userId);
    const hasCharacter = characters.some((character) => character.userId === userId);
    if (!isPlayer || !hasCharacter) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'not-in-game' });
      return { ok: false, status: 403, error: 'User not in game' };
    }
    let interactions = game.state?.public?.customInteractions ?? [];
    const hasPendingInteractions = interactions.some((interaction) => interaction.status === 'pending');
    if (hasPendingInteractions) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'pending-interaction' });
      return { ok: false, status: 409, error: 'Action set rejected: pending interaction in progress' };
    }
    const beats = game.state?.public?.beats ?? game.state?.public?.timeline ?? [];
    const character = characters.find((candidate) => candidate.userId === userId);
    console.log(`${LOG_PREFIX} action:set pre`, {
      userId,
      gameId,
      earliestIndex: getTimelineEarliestEIndex(beats, characters),
      timeline: buildTimelineSummary(beats, characters),
      pendingActions: game.state?.public?.pendingActions ?? null,
    });
    if (!isCharacterAtEarliestE(beats, characters, character)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'behind-earliest-e' });
      return {
        ok: false,
        status: 409,
        error: 'Action set rejected: player is behind the earliest timeline beat',
      };
    }
    const earliestIndex = getTimelineEarliestEIndex(beats, characters);
    const atBatCharacters = getCharactersAtEarliestE(beats, characters);
    const atBatUserIds = Array.from(new Set(atBatCharacters.map((candidate) => candidate.userId).filter(Boolean)));
    const comboInteraction = findComboContinuation(interactions, userId, earliestIndex);
    const comboRequired = Boolean(comboInteraction);
    const match = await db.findMatch(game.matchId);
    const catalog = await loadCardCatalog();
    const deckStates = await ensureDeckStatesForGame(game, match);
    const land = game.state?.public?.land ?? [];
    resolveLandRefreshes(deckStates, beats, characters, land, interactions, game.state?.public?.pendingActions);
    const deckState = deckStates.get(userId);
    if (!deckState) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'missing-deck-state' });
      return { ok: false, status: 500, error: 'Missing deck state for player' };
    }
    if (atBatUserIds.length <= 1) {
      const validation = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
      if (isActionValidationFailure(validation)) {
        console.log(`${LOG_PREFIX} action:set validation-failed`, {
          userId,
          gameId,
          error: validation.error,
        });
        return { ok: false, status: 400, error: validation.error.message, code: validation.error.code };
      }
      if (comboRequired) {
        const activeCard = catalog.cardsById.get(activeCardId ?? '');
        if (!cardHasCombo(activeCard)) {
          console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'combo-required' });
          return {
            ok: false,
            status: 409,
            error: 'Action set rejected: active card must include a Co step for combo follow-up',
            code: 'combo-required',
          };
        }
      }
      const actionList = comboRequired ? withComboStarter(validation.actionList) : validation.actionList;
      console.log(`${LOG_PREFIX} action:set actionList`, {
        userId,
        gameId,
        actionList: actionList.map((item) => ({
          action: item.action,
          rotation: item.rotation,
          priority: item.priority,
          interaction: item.interaction?.type ?? null,
        })),
      });
      const pendingResult = applyCardUse(deckState, {
        movementCardId: validation.movementCardId,
        abilityCardId: validation.abilityCardId,
        activeCardId,
        passiveCardId,
      });
      if (!pendingResult.ok) {
        const error = (pendingResult as { error: { message: string; code: string } }).error;
        console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: error.code, error });
        return { ok: false, status: 409, error: error.message, code: error.code };
      }
      if (comboInteraction) {
        interactions = interactions.filter((item) => item.id !== comboInteraction.id);
        game.state.public.customInteractions = interactions;
      }
      pendingActionSets.delete(game.id);
      game.state.public.pendingActions = undefined;
      const actionPlay = {
        type: 'action-set',
        activeCardId: activeCardId ?? null,
        passiveCardId: passiveCardId ?? null,
        rotation: rotation ?? '',
      };
      const updatedBeats = applyActionSetToBeats(beats, characters, userId, actionList, [actionPlay]);
      const comboAvailability = buildComboAvailability(deckStates, catalog);
      const executed = executeBeatsWithInteractions(updatedBeats, characters, interactions, land, comboAvailability);
      game.state.public.beats = executed.beats;
      game.state.public.timeline = executed.beats;
      game.state.public.characters = executed.characters;
      game.state.public.customInteractions = executed.interactions;
      resolveLandRefreshes(deckStates, executed.beats, executed.characters, land, executed.interactions);
      applyMatchOutcome(game, deckStates);
      console.log(`${LOG_PREFIX} action:set post`, {
        userId,
        gameId,
        timeline: buildTimelineSummary(executed.beats, executed.characters),
        lastCalculated: executed.lastCalculated,
        pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
      });
      const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
      sendGameUpdate(match, updatedGame, deckStates);
      const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
      return { ok: true, status: 200, payload: view };
    }

    let batch = pendingActionSets.get(game.id);
    if (!batch || batch.beatIndex !== earliestIndex) {
      batch = { beatIndex: earliestIndex, requiredUserIds: atBatUserIds, submitted: new Map() };
      pendingActionSets.set(game.id, batch);
    }
    if (!batch.requiredUserIds.includes(userId)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'not-required' });
      return { ok: false, status: 409, error: 'Action set rejected: player is not required for current beat' };
    }
    if (batch.submitted.has(userId)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'already-submitted' });
      return { ok: false, status: 409, error: 'Action set already submitted for this beat' };
    }
    const validation = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
    if (isActionValidationFailure(validation)) {
      console.log(`${LOG_PREFIX} action:set validation-failed`, {
        userId,
        gameId,
        error: validation.error,
      });
      return { ok: false, status: 400, error: validation.error.message, code: validation.error.code };
    }
    if (comboRequired) {
      const activeCard = catalog.cardsById.get(activeCardId ?? '');
      if (!cardHasCombo(activeCard)) {
        console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'combo-required' });
        return {
          ok: false,
          status: 409,
          error: 'Action set rejected: active card must include a Co step for combo follow-up',
          code: 'combo-required',
        };
      }
    }
    const actionList = comboRequired ? withComboStarter(validation.actionList) : validation.actionList;
    console.log(`${LOG_PREFIX} action:set actionList`, {
      userId,
      gameId,
      actionList: actionList.map((item) => ({
        action: item.action,
        rotation: item.rotation,
        priority: item.priority,
        interaction: item.interaction?.type ?? null,
      })),
    });
    const pendingResult = applyCardUse(deckState, {
      movementCardId: validation.movementCardId,
      abilityCardId: validation.abilityCardId,
      activeCardId,
      passiveCardId,
    });
    if (!pendingResult.ok) {
      const error = (pendingResult as { error: { message: string; code: string } }).error;
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: error.code, error });
      return { ok: false, status: 409, error: error.message, code: error.code };
    }
    if (comboInteraction) {
      interactions = interactions.filter((item) => item.id !== comboInteraction.id);
      game.state.public.customInteractions = interactions;
    }
    const actionPlay = {
      type: 'action-set',
      activeCardId: activeCardId ?? null,
      passiveCardId: passiveCardId ?? null,
      rotation: rotation ?? '',
    };
    batch.submitted.set(userId, { actionList, play: [actionPlay] });
    game.state.public.pendingActions = {
      beatIndex: batch.beatIndex,
      requiredUserIds: [...batch.requiredUserIds],
      submittedUserIds: Array.from(batch.submitted.keys()),
    };
    console.log(`${LOG_PREFIX} action:set pending`, {
      gameId,
      beatIndex: batch.beatIndex,
      requiredUserIds: batch.requiredUserIds,
      submittedUserIds: Array.from(batch.submitted.keys()),
    });
    const pendingGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, pendingGame, deckStates);
    if (batch.submitted.size < batch.requiredUserIds.length) {
      const view = buildGameViewForPlayer(pendingGame, userId, deckStates);
      return { ok: true, status: 200, payload: view };
    }
    let updatedBeats = beats;
    batch.requiredUserIds.forEach((requiredId) => {
      const submission = batch?.submitted.get(requiredId);
      if (submission) {
        updatedBeats = applyActionSetToBeats(updatedBeats, characters, requiredId, submission.actionList, submission.play);
      }
    });
    const comboAvailability = buildComboAvailability(deckStates, catalog);
    const executed = executeBeatsWithInteractions(updatedBeats, characters, interactions, land, comboAvailability);
    game.state.public.beats = executed.beats;
    game.state.public.timeline = executed.beats;
    game.state.public.characters = executed.characters;
    game.state.public.customInteractions = executed.interactions;
    resolveLandRefreshes(deckStates, executed.beats, executed.characters, land, executed.interactions);
    game.state.public.pendingActions = undefined;
    pendingActionSets.delete(game.id);
    applyMatchOutcome(game, deckStates);
    console.log(`${LOG_PREFIX} action:set post`, {
      userId,
      gameId,
      timeline: buildTimelineSummary(executed.beats, executed.characters),
      lastCalculated: executed.lastCalculated,
      pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
    });
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };

  const resolveInteraction = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    const interactionId = (body.interactionId as string) || (body.interactionID as string);
    const directionIndex = (body.directionIndex as number) ?? (body.direction as number);
    console.log(`${LOG_PREFIX} interaction:resolve request`, { userId, gameId, interactionId, directionIndex });
    if (!userId || !gameId || !interactionId) {
      return { ok: false, status: 400, error: 'Invalid interaction payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    if (game.state?.public?.matchOutcome) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'match-ended' });
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public?.characters ?? [];
    const isPlayer = game.players.some((player) => player.userId === userId);
    const hasCharacter = characters.some((character) => character.userId === userId);
    if (!isPlayer || !hasCharacter) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-in-game' });
      return { ok: false, status: 403, error: 'User not in game' };
    }
    const interactions = game.state?.public?.customInteractions ?? [];
    const interaction = interactions.find((item) => item.id === interactionId);
    if (!interaction || interaction.status !== 'pending') {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-pending' });
      return { ok: false, status: 409, error: 'Interaction is no longer pending' };
    }
    if (interaction.actorUserId !== userId) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-authorized' });
      return { ok: false, status: 403, error: 'User is not authorized to resolve this interaction' };
    }
    const beats = game.state?.public?.beats ?? game.state?.public?.timeline ?? [];
    const land = game.state?.public?.land ?? [];
    const match = await db.findMatch(game.matchId);
    const deckStates = await ensureDeckStatesForGame(game, match);
    const catalog = await loadCardCatalog();
    const comboAvailability = buildComboAvailability(deckStates, catalog);

    if (interaction.type === 'throw') {
      const resolvedDirection = Number(directionIndex);
      if (!Number.isFinite(resolvedDirection) || resolvedDirection < 0 || resolvedDirection > 5) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-direction' });
        return { ok: false, status: 400, error: 'Invalid throw direction' };
      }
      interaction.status = 'resolved';
      interaction.resolution = { directionIndex: Math.round(resolvedDirection) };
    } else if (interaction.type === 'combo') {
      const rawContinue = (body as { continueCombo?: unknown; comboContinue?: unknown })?.continueCombo;
      const altContinue = (body as { comboContinue?: unknown })?.comboContinue;
      const fallbackContinue = (body as { continue?: unknown })?.continue;
      const resolvedContinue =
        typeof rawContinue === 'boolean'
          ? rawContinue
          : typeof altContinue === 'boolean'
            ? altContinue
            : typeof fallbackContinue === 'boolean'
              ? fallbackContinue
              : null;
      if (resolvedContinue === null) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-combo-choice' });
        return { ok: false, status: 400, error: 'Invalid combo choice' };
      }
      interaction.status = 'resolved';
      interaction.resolution = { continue: resolvedContinue };
    } else {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'unsupported-type' });
      return { ok: false, status: 400, error: 'Unsupported interaction type' };
    }

    const executed = executeBeatsWithInteractions(beats, characters, interactions, land, comboAvailability);
    game.state.public.beats = executed.beats;
    game.state.public.timeline = executed.beats;
    game.state.public.characters = executed.characters;
    game.state.public.customInteractions = executed.interactions;
    resolveLandRefreshes(deckStates, executed.beats, executed.characters, land, executed.interactions);
    applyMatchOutcome(game, deckStates);
    console.log(`${LOG_PREFIX} interaction:resolve post`, {
      userId,
      gameId,
      timeline: buildTimelineSummary(executed.beats, executed.characters),
      lastCalculated: executed.lastCalculated,
    });
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };
  const handleWsMessage = async (client: WsClient, raw: string) => {
    let message: { type?: string; payload?: Record<string, unknown> } | null = null;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      sendWsEvent({ type: 'error', payload: { message: 'Invalid JSON payload' } }, client.userId);
      return;
    }
    if (!message || typeof message !== 'object') return;
    const { type, payload } = message;
    if (!type) return;
    if (type === 'input:submit') {
      const submission = { ...(payload ?? {}) } as Record<string, unknown>;
      if (!submission.userId) {
        submission.userId = client.userId;
      }
      const result = await submitActionSet(submission);
      if (result.ok) {
        sendWsEvent({ type: 'input:ack', payload: result.payload }, client.userId);
      } else {
        sendWsEvent({ type: 'error', payload: { message: result.error, code: result.code } }, client.userId);
      }
      return;
    }
    if (type === 'interaction:resolve') {
      const submission = { ...(payload ?? {}) } as Record<string, unknown>;
      if (!submission.userId) {
        submission.userId = client.userId;
      }
      const result = await resolveInteraction(submission);
      if (result.ok) {
        sendWsEvent({ type: 'interaction:ack', payload: result.payload }, client.userId);
      } else {
        sendWsEvent({ type: 'error', payload: { message: result.error, code: result.code } }, client.userId);
      }
    }
  };

  const handleWsUpgrade = async (req: any, socket: any) => {
    const { pathname, query } = parse(req.url || '', true);
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.end();
      return;
    }
    const key = req.headers?.['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.end();
      return;
    }
    const accept = buildWsAccept(key);
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    const requestedUserId = typeof query?.userId === 'string' ? query.userId : undefined;
    const requestedUsername = typeof query?.username === 'string' ? query.username : undefined;
    const user = await upsertUserFromRequest(requestedUserId, requestedUsername);
    const clientId = randomUUID();
    const client: WsClient = {
      id: clientId,
      userId: user.id,
      socket,
      buffer: Buffer.alloc(0),
    };
    wsClients.set(clientId, client);
    sendWsEvent(
      { type: 'connected', payload: { userId: user.id, username: user.username, lobby: lobby.serialize() } },
      user.id,
    );
    void sendActiveMatchState(user.id);
    socket.on('data', (chunk: Buffer) => {
      const current = wsClients.get(clientId);
      if (!current) return;
      const merged = current.buffer.length ? Buffer.concat([current.buffer, chunk]) : chunk;
      const { messages, remaining } = decodeWsMessages(merged);
      current.buffer = remaining;
      messages.forEach((rawMessage) => {
        void handleWsMessage(current, rawMessage);
      });
    });
    const cleanup = () => {
      wsClients.delete(clientId);
    };
    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);
  };

  const server = createServer(async (req: any, res: any) => {
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
      if (req.method === 'POST' && pathname.startsWith('/api/v1/match/') && pathname.endsWith('/exit')) {
        const matchId = pathname.split('/')[4];
        const body = await parseBody(req);
        const userId = (body.userId as string) || (body.userID as string);
        if (!matchId || !userId) {
          return respondJson(res, 400, { error: 'Invalid exit payload' });
        }
        const match = await db.findMatch(matchId);
        if (!match) return notFound(res);
        if (!match.players.some((player) => player.userId === userId)) {
          return respondJson(res, 403, { error: 'User not in match' });
        }
        if (match.gameId) {
          const exitSet = matchExitUsers.get(match.gameId) ?? new Set<string>();
          exitSet.add(userId);
          matchExitUsers.set(match.gameId, exitSet);
        }
        lobby.removeFromQueue(userId);
        return respondJson(res, 200, { ok: true });
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
      if (req.method === 'GET' && pathname.startsWith('/api/v1/game/') && pathname.endsWith('/snapshot')) {
        const gameId = pathname.split('/')[4];
        const game = await db.findGame(gameId);
        if (!game) return notFound(res);
        return respondJson(res, 200, {
          gameId: game.id,
          matchId: game.matchId,
          state: { public: game.state.public },
        });
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/action-set') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid action set payload' });
        }
        const result = await submitActionSet(body);
        if (!result.ok) {
          return respondJson(res, result.status, { error: result.error, code: result.code });
        }
        return respondJson(res, result.status, result.payload);
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/interaction') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid interaction payload' });
        }
        const result = await resolveInteraction(body);
        if (!result.ok) {
          return respondJson(res, result.status, { error: result.error, code: result.code });
        }
        return respondJson(res, result.status, result.payload);
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

  server.on('upgrade', (req: any, socket: any) => {
    void handleWsUpgrade(req, socket);
  });

  server.listen(port, () => {
    lobby.clearQueues();
    sendRealtimeEvent({ type: 'queueChanged', payload: lobby.serialize() });
    setInterval(() => {
      launchBotIfNeeded();
    }, 5000);
    setInterval(() => {
      void matchmakeQuickplay();
    }, 2000);
  });

  return server;
}
