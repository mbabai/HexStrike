import { randomUUID } from 'crypto';
import { GameDoc, MatchDoc, UserDoc } from '../types';

export class MemoryDb {
  private users: UserDoc[] = [];
  private matches: MatchDoc[] = [];
  private games: GameDoc[] = [];

  async upsertUser(user: Partial<UserDoc> & { username: string; id?: string }): Promise<UserDoc> {
    const now = new Date();
    const existing = this.users.find((u) => u.username === user.username || u.id === user.id);
    if (existing) {
      Object.assign(existing, user, { updatedAt: now });
      return existing;
    }
    const fresh: UserDoc = {
      id: user.id || randomUUID(),
      username: user.username,
      email: user.email,
      elo: user.elo ?? 1000,
      characterId: user.characterId,
      isBot: user.isBot,
      botDifficulty: user.botDifficulty,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(fresh);
    return fresh;
  }

  async findUser(id: string): Promise<UserDoc | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async listUsers(): Promise<UserDoc[]> {
    return [...this.users];
  }

  async createMatch(payload: Omit<MatchDoc, 'id' | 'createdAt' | 'updatedAt'>): Promise<MatchDoc> {
    const now = new Date();
    const match: MatchDoc = { ...payload, id: randomUUID(), createdAt: now, updatedAt: now };
    this.matches.push(match);
    return match;
  }

  async updateMatch(id: string, updates: Partial<MatchDoc>): Promise<MatchDoc | undefined> {
    const match = this.matches.find((m) => m.id === id);
    if (!match) return undefined;
    Object.assign(match, updates, { updatedAt: new Date() });
    return match;
  }

  async findMatch(id: string): Promise<MatchDoc | undefined> {
    return this.matches.find((match) => match.id === id);
  }

  async findActiveMatchByUser(userId: string): Promise<MatchDoc | undefined> {
    return [...this.matches]
      .reverse()
      .find((match) => match.state !== 'complete' && match.players.some((player) => player.userId === userId));
  }

  async createGame(payload: Omit<GameDoc, 'id' | 'createdAt' | 'updatedAt'>): Promise<GameDoc> {
    const now = new Date();
    const game: GameDoc = { ...payload, id: randomUUID(), createdAt: now, updatedAt: now };
    this.games.push(game);
    return game;
  }

  async updateGame(id: string, updates: Partial<GameDoc>): Promise<GameDoc | undefined> {
    const game = this.games.find((g) => g.id === id);
    if (!game) return undefined;
    Object.assign(game, updates, { updatedAt: new Date() });
    return game;
  }

  async findGame(id: string): Promise<GameDoc | undefined> {
    return this.games.find((game) => game.id === id);
  }

  async listMatches(limit = 25): Promise<MatchDoc[]> {
    return [...this.matches].slice(-limit).reverse();
  }

  async listGames(limit = 25): Promise<GameDoc[]> {
    return [...this.games].slice(-limit).reverse();
  }
}
