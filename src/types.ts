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
  characterId?: CharacterId;
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
    characterId: CharacterId;
  }>;
  gameId: string;
  winsRequired: number;
  state: 'pending' | 'in-progress' | 'complete';
  winnerId?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface HexCoord {
  q: number;
  r: number;
}

export type CharacterId = 'murelious' | 'strylan' | 'monkey-queen' | 'ryathan' | 'zenytha' | 'aumandetta';

export type Facing = number;

export interface CharacterState {
  userId: string;
  username: string;
  characterId: CharacterId;
  characterName: string;
  position: HexCoord;
  facing: Facing;
}

export interface BeatAction {
  username: string;
  action: string;
  rotation: string;
  priority: number;
  damage: number;
  location: HexCoord;
  facing: Facing;
  calculated: boolean;
  interaction?: BeatInteraction;
}

export type CustomInteractionType = 'throw';

export interface BeatInteraction {
  type: CustomInteractionType;
}

export interface ActionSetItem {
  action: string;
  rotation: string;
  priority: number;
  interaction?: BeatInteraction;
}

export type BeatEntry = BeatAction[];

export interface PendingActions {
  beatIndex: number;
  requiredUserIds: string[];
  submittedUserIds: string[];
}

export interface GameStatePublic {
  land: HexCoord[];
  beats: BeatEntry[];
  characters: CharacterState[];
  pendingActions?: PendingActions;
  customInteractions?: CustomInteraction[];
}

export interface CustomInteraction {
  id: string;
  type: CustomInteractionType;
  beatIndex: number;
  actorUserId: string;
  targetUserId: string;
  status: 'pending' | 'resolved';
  resolution?: {
    directionIndex?: number;
  };
}

export interface GameStateSecret {
  [key: string]: unknown;
}

export interface GameState {
  /**
   * Public state can be shared with players and (eventually) spectators.
   */
  public: GameStatePublic;
  secret: GameStateSecret;
}

export interface GameDoc {
  id: string;
  matchId: string;
  players: Array<{ userId: string; ready: boolean; turn: boolean }>;
  timers: { turnSeconds: number; incrementSeconds: number };
  outcome?: { reason: string; victorId?: string };
  state: GameState;
  createdAt: Date;
  updatedAt: Date;
}
