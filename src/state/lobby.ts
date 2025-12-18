import { EventEmitter } from 'events';
import { LobbySnapshot, QueueName } from '../types';

export interface LobbyStore extends LobbySnapshot {
  events: EventEmitter;
  addToQueue(userId: string, queue: QueueName): void;
  removeFromQueue(userId: string, queue?: QueueName): void;
  markInGame(userIds: string[]): void;
  clearQueues(): void;
  serialize(): LobbySnapshot;
}

const queues: QueueName[] = ['quickplayQueue', 'rankedQueue', 'botQueue'];

export function createLobbyStore(): LobbyStore {
  const state: LobbySnapshot = {
    quickplayQueue: [],
    rankedQueue: [],
    botQueue: [],
    inGame: [],
  };

  const events = new EventEmitter();

  const broadcast = () => {
    events.emit('queueChanged', serialize());
  };

  const sanitizeQueue = (queue: string[]): string[] => {
    const seen = new Set<string>();
    return queue.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const serialize = (): LobbySnapshot => ({
    quickplayQueue: [...state.quickplayQueue],
    rankedQueue: [...state.rankedQueue],
    botQueue: [...state.botQueue],
    inGame: [...state.inGame],
  });

  const addToQueue = (userId: string, queue: QueueName) => {
    if (!queues.includes(queue) || !userId) return;
    removeFromQueue(userId);
    if (!state[queue].includes(userId)) {
      const unique = sanitizeQueue([...state[queue], userId]);
      state[queue].splice(0, state[queue].length, ...unique);
      broadcast();
    }
  };

  const removeFromQueue = (userId: string, queue?: QueueName) => {
    const targetQueues = queue ? [queue] : queues;
    let changed = false;
    targetQueues.forEach((q) => {
      const before = state[q].length;
      const remaining = state[q].filter((id) => id !== userId);
      state[q].splice(0, state[q].length, ...remaining);
      if (state[q].length !== before) changed = true;
    });
    const remainingInGame = state.inGame.filter((id) => id !== userId);
    state.inGame.splice(0, state.inGame.length, ...remainingInGame);
    if (changed) broadcast();
  };

  const markInGame = (userIds: string[]) => {
    let changed = false;
    userIds.forEach((id) => {
      removeFromQueue(id);
      if (!state.inGame.includes(id)) {
        state.inGame.push(id);
        changed = true;
      }
    });
    if (changed) broadcast();
  };

  const clearQueues = () => {
    state.quickplayQueue.splice(0, state.quickplayQueue.length);
    state.rankedQueue.splice(0, state.rankedQueue.length);
    state.botQueue.splice(0, state.botQueue.length);
    state.inGame.splice(0, state.inGame.length);
    broadcast();
  };

  return {
    ...state,
    events,
    addToQueue,
    removeFromQueue,
    markInGame,
    clearQueues,
    serialize,
  } as LobbyStore;
}
