export type QueueName = 'quickplayQueue' | 'rankedQueue' | 'botQueue';

export interface LobbySnapshot {
  quickplayQueue: string[];
  rankedQueue: string[];
  botQueue: string[];
  inGame: string[];
}

export interface UserDoc {
  id: string;
  username: string;
  email?: string;
  elo: number;
  isBot?: boolean;
  botDifficulty?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchDoc {
  id: string;
  players: Array<{
    userId: string;
    username: string;
    score: number;
    eloChange: number;
  }>;
  gameId: string;
  winsRequired: number;
  state: 'pending' | 'in-progress' | 'complete';
  winnerId?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GameDoc {
  id: string;
  matchId: string;
  players: Array<{ userId: string; ready: boolean; turn: boolean }>;
  timers: { turnSeconds: number; incrementSeconds: number };
  outcome?: { reason: string; victorId?: string };
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
