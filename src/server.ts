import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { readFile } from 'fs';
import { randomUUID } from 'crypto';
import { createLobbyStore } from './state/lobby';
import { CharacterId, GameDoc, LobbySnapshot, MatchDoc, QueueName, UserDoc } from './types';
import { MemoryDb } from './persistence/memoryDb';
import { createInitialGameState } from './game/state';

interface EventPacket {
  type: string;
  payload?: unknown;
}

export function buildServer(port: number) {
  const lobby = createLobbyStore();
  const db = new MemoryDb();
  const sseClients = new Map<string, ServerResponse>();
  const pendingInvites = new Map<string, { from: string; to: string; createdAt: Date }>();
  const matchDisconnects = new Map<string, Set<string>>();
  const winsRequired = 3;
  const characterIds: CharacterId[] = ['murelious', 'monkey-queen'];

  const pickRandomCharacterId = () => characterIds[Math.floor(Math.random() * characterIds.length)];

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

  const getPresenceSnapshot = () => {
    const snapshot = lobby.serialize();
    return {
      connected: Array.from(sseClients.keys()),
      quickplayQueue: [...snapshot.quickplayQueue],
    };
  };

  const upsertUserFromRequest = async (userId?: string, username?: string): Promise<UserDoc> => {
    return db.upsertUser({ id: userId, username: username || userId || randomUUID(), elo: 1000 });
  };

  const ensureUserCharacter = async (user: UserDoc): Promise<UserDoc> => {
    if (user.characterId) return user;
    return db.upsertUser({ id: user.id, username: user.username, characterId: pickRandomCharacterId() });
  };

  const handleJoin = async (body: any) => {
    const user = await upsertUserFromRequest(body.userId, body.username);
    const assignedUser = await ensureUserCharacter(user);
    const queue: QueueName = body.queue || 'quickplayQueue';
    lobby.addToQueue(assignedUser.id, queue);
    if (queue === 'quickplayQueue') {
      console.log(`[lobby] ${assignedUser.username} (${assignedUser.id}) joined quickplay queue`);
    }
    return { user: assignedUser, lobby: lobby.serialize() };
  };

  const handleLeave = async (body: any) => {
    if (body.userId) lobby.removeFromQueue(body.userId, body.queue as QueueName | undefined);
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
        match.players.map((player) => ({ userId: player.userId, characterId: player.characterId })),
      ),
    });
  };

  const notifyMatchPlayers = (match: MatchDoc, game: GameDoc) => {
    match.players.forEach((player) => {
      sendEvent({ type: 'match:created', payload: match }, player.userId);
      sendEvent({ type: 'game:update', payload: game }, player.userId);
    });
  };

  const createMatchWithUsers = async (users: Array<{ id: string; username?: string }>) => {
    const resolved = await Promise.all(users.map((user) => upsertUserFromRequest(user.id, user.username || user.id)));
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
      if (game) sendEvent({ type: 'game:update', payload: game }, userId);
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
    return match;
  };

  const serveEvents = (req: IncomingMessage, res: ServerResponse) => {
    const { query } = parse(req.url || '', true);
    const userId = (query.userId as string) || randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', payload: { userId, lobby: lobby.serialize() } })}\n\n`);
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
        return respondJson(res, 200, getPresenceSnapshot());
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/join') {
        try {
          const body = await parseBody(req);
          const result = await handleJoin(body);
          return respondJson(res, 200, result);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid join payload' });
        }
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/leave') {
        const body = await parseBody(req);
        const result = await handleLeave(body);
        return respondJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/clear') {
        lobby.clearQueues();
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

    if (pathname.startsWith('/api/v1/history')) {
      if (req.method === 'GET' && pathname === '/api/v1/history/matches') {
        return respondJson(res, 200, await db.listMatches());
      }
      if (req.method === 'GET' && pathname === '/api/v1/history/games') {
        return respondJson(res, 200, await db.listGames());
      }
    }

    if (pathname === '/' || pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/public')) {
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
