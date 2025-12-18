import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { readFile } from 'fs';
import { randomUUID } from 'crypto';
import { createLobbyStore } from './state/lobby';
import { GameDoc, LobbySnapshot, MatchDoc, QueueName, UserDoc } from './types';
import { MemoryDb } from './persistence/memoryDb';

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

  const upsertUserFromRequest = async (userId?: string, username?: string): Promise<UserDoc> => {
    return db.upsertUser({ id: userId, username: username || userId || randomUUID(), elo: 1000 });
  };

  const handleJoin = async (body: any) => {
    const user = await upsertUserFromRequest(body.userId, body.username);
    const queue: QueueName = body.queue || 'quickplayQueue';
    lobby.addToQueue(user.id, queue);
    return { user, lobby: lobby.serialize() };
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
      state: {},
    });
  };

  const createCustomMatch = async (body: any) => {
    const host = await upsertUserFromRequest(body.hostId, body.hostName || body.hostId);
    const guest = await upsertUserFromRequest(body.guestId, body.guestName || body.guestId);
    lobby.markInGame([host.id, guest.id]);
    const match = await db.createMatch({
      players: [
        { userId: host.id, username: host.username, score: 0, eloChange: 0 },
        { userId: guest.id, username: guest.username, score: 0, eloChange: 0 },
      ],
      gameId: '',
      state: 'in-progress',
      winnerId: undefined,
      completedAt: undefined,
    });
    const game = await createSkeletonGame(match);
    await db.updateMatch(match.id, { gameId: game.id });
    sendEvent({ type: 'match:created', payload: match });
    sendEvent({ type: 'game:update', payload: game });
    return { match, game };
  };

  const launchBotIfNeeded = async () => {
    const snapshot = lobby.serialize();
    const botCandidate = snapshot.botQueue[0];
    if (!botCandidate) return;
    lobby.removeFromQueue(botCandidate, 'botQueue');
    const bot = await db.upsertUser({ username: 'Bot', isBot: true, botDifficulty: 'easy' });
    await createCustomMatch({ hostId: botCandidate, guestId: bot.id, guestName: bot.username });
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

    req.on('close', () => {
      sseClients.delete(userId);
      matchDisconnects.forEach((set) => set.delete(userId));
    });
  };

  const handleStatic = (res: ServerResponse, path: string) => {
    const resolved = path === '/' ? '/public/index.html' : path.startsWith('/public/') ? path : `/public${path}`;
    readFile(process.cwd() + resolved, (err, data) => {
      if (err) {
        notFound(res);
      } else {
        let type = 'text/plain';
        if (resolved.endsWith('.html')) type = 'text/html';
        if (resolved.endsWith('.css')) type = 'text/css';
        if (resolved.endsWith('.js')) type = 'text/javascript';
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

    if (pathname === '/' || pathname.startsWith('/public')) {
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
  });

  return server;
}
