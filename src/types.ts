export type QueueName = 'quickplayQueue' | 'rankedQueue' | 'botQueue';

export interface LobbySnapshot {
  quickplayQueue: string[];
  rankedQueue: string[];
  botQueue: string[];
  inGame: string[];
}

export type CharacterId =
  | 'murelious'
  | 'strylan'
  | 'monkey-queen'
  | 'ryathan'
  | 'zenytha'
  | 'aumandetta';

export interface HexCoord {
  q: number;
  r: number;
}

export interface Player {
  id: string;
  username: string;
  characterId: CharacterId;
}

export interface Character {
  id: string;
  ownerPlayerId: string;
  hp: number;
  position: HexCoord;
  rotation: number;
}

export interface Hand {
  movementCards: string[];
  abilityCards: string[];
}

export interface Zones {
  deck: string[];
  hand: Hand;
  discard: string[];
}

export type TriggerType = 'require_input' | 'reaction' | 'interrupt';
export type TriggerTarget = 'single_player' | 'all_players';

export interface Trigger {
  type: TriggerType;
  target: TriggerTarget;
}

export interface Beat {
  index: number;
  playerId: string | null;
  action: string;
  text?: string;
  rotation?: number;
  priority?: number;
  triggers?: Trigger[];
  requiresInput: boolean;
}

export interface Timeline {
  beats: Beat[];
  currentBeatIndex: number;
}

export interface PlayerInput {
  playerId: string;
  payload: unknown;
}

export interface PendingInputs {
  beatIndex: number;
  requiredPlayerIds: string[];
  submittedInputs: Record<string, PlayerInput>;
}

export type CardType = 'movement' | 'ability';

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  priority: number;
  actions: string[];
  rotations: string;
  damage?: number;
  kbf?: number;
  activeText?: string;
  passiveText?: string;
}

export interface DeckDefinition {
  movement: string[];
  ability: string[];
}

export interface CardCatalog {
  movement: CardDefinition[];
  ability: CardDefinition[];
  decks: DeckDefinition[];
  cardsById: Map<string, CardDefinition>;
}

export interface DeckState {
  movement: string[];
  abilityHand: string[];
  abilityDeck: string[];
  exhaustedMovementIds: Set<string>;
  lastRefreshIndex: number | null;
  activeCardId: string | null;
  passiveCardId: string | null;
}

export interface PlayerCardState {
  deck: string[];
  movementHand: string[];
  abilityHand: string[];
  activeCardId: string | null;
  passiveCardId: string | null;
  discardPile: string[];
  lastRefreshIndex: number | null;
}

export interface CardValidationError {
  code: string;
  message: string;
}

export type RotationSource = 'selected' | 'forced';

export interface ActionListItem {
  action: string;
  rotation: string;
  rotationSource?: RotationSource;
  priority: number;
  interaction?: BeatInteraction;
  damage?: number;
  kbf?: number;
  comboStarter?: boolean;
  cardId?: string;
  passiveCardId?: string;
}

export interface ActionSubmission {
  activeCardId: string | null;
  passiveCardId: string | null;
  rotation: string;
}

export interface CardUse {
  movementCardId: string;
  abilityCardId: string;
  activeCardId?: string | null;
  passiveCardId?: string | null;
}

export type ActionValidationResult =
  | {
      ok: true;
      actionList: ActionListItem[];
      movementCardId: string;
      abilityCardId: string;
    }
  | {
      ok: false;
      error: CardValidationError;
    };

export interface BeatInteraction {
  type: string;
  [key: string]: unknown;
}

export interface BeatEntry {
  username?: string;
  userId?: string;
  userID?: string;
  action: string;
  rotation: string;
  rotationSource?: RotationSource;
  priority: number;
  damage: number;
  location: HexCoord;
  terrain?: 'land' | 'abyss';
  facing: number;
  calculated: boolean;
  interaction?: BeatInteraction;
  attackDamage?: number;
  attackKbf?: number;
  triggers?: string[];
  play?: unknown[];
  status?: string;
  comboStarter?: boolean;
  comboSkipped?: boolean;
  cardId?: string;
  passiveCardId?: string;
  consequences?: Array<{
    type: 'hit';
    damageDelta: number;
    knockbackDistance: number;
  }>;
}

export interface PendingActions {
  beatIndex: number;
  requiredUserIds: string[];
  submittedUserIds: string[];
}

export interface CustomInteraction {
  id: string;
  type: string;
  beatIndex: number;
  actorUserId: string;
  targetUserId: string;
  status: 'pending' | 'resolved';
  resolution?: { directionIndex?: number; continue?: boolean; [key: string]: unknown };
}

export interface MatchOutcome {
  winnerUserId: string;
  loserUserId: string;
  reason: 'no-cards-abyss' | 'far-from-land';
  beatIndex: number;
}

export interface PublicCharacter {
  userId: string;
  username: string;
  characterId: CharacterId;
  characterName?: string;
  position: HexCoord;
  facing: number;
  damage?: number;
}

export interface GamePublicState {
  land: HexCoord[];
  beats: BeatEntry[][];
  timeline?: BeatEntry[][];
  characters: PublicCharacter[];
  pendingActions?: PendingActions;
  customInteractions: CustomInteraction[];
  matchOutcome?: MatchOutcome;
}

export interface EngineState {
  players: Player[];
  characters: Character[];
  zonesByPlayerId: Record<string, Zones>;
  timeline: Timeline;
  pendingInputs?: PendingInputs;
}

export interface GameStateDoc {
  public: GamePublicState;
  secret: Record<string, unknown>;
  engine?: EngineState;
}

export interface MatchPlayerDoc {
  userId: string;
  username: string;
  score: number;
  eloChange: number;
  characterId: CharacterId;
}

export type MatchState = 'pending' | 'in-progress' | 'complete';

export interface MatchDoc {
  id: string;
  players: MatchPlayerDoc[];
  gameId: string;
  winsRequired: number;
  state: MatchState;
  winnerId?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GamePlayerDoc {
  userId: string;
  ready: boolean;
  turn: boolean;
}

export interface GameTimers {
  turnSeconds: number;
  incrementSeconds: number;
}

export interface GameDoc {
  id: string;
  matchId: string;
  players: GamePlayerDoc[];
  timers: GameTimers;
  outcome?: unknown;
  state: GameStateDoc;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDoc {
  id: string;
  username: string;
  email?: string;
  elo: number;
  characterId?: CharacterId;
  isBot?: boolean;
  botDifficulty?: 'easy' | 'medium' | 'hard';
  createdAt: Date;
  updatedAt: Date;
}
