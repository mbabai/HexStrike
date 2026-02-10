import { ActionListItem, BeatEntry, PublicCharacter } from '../types';
import { getTimelineResolvedIndex } from './beatTimeline';

const DEFAULT_ACTION = 'E';
const FOCUS_ACTION = 'F';
const LOG_PREFIX = '[actionSets]';

const isOpenBeatAction = (action: string | undefined) => {
  const normalized = `${action ?? ''}`.trim().toUpperCase();
  return normalized === DEFAULT_ACTION || normalized === FOCUS_ACTION;
};

const cloneLocation = (location?: { q: number; r: number }) =>
  location ? { q: location.q, r: location.r } : { q: 0, r: 0 };

const normalizeFacing = (facing: number | string | undefined, fallback: number) => {
  if (typeof facing === 'number' && Number.isFinite(facing)) return facing;
  const parsed = typeof facing === 'string' ? Number(facing) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const matchesEntryForCharacter = (entry: BeatEntry, character: PublicCharacter) => {
  const key = entry.username ?? entry.userId ?? entry.userID;
  return key === character.username || key === character.userId;
};

const findEntryForUser = (beat: BeatEntry[], target: PublicCharacter) =>
  beat.find((entry) => matchesEntryForCharacter(entry, target));

const cloneEntry = (entry: BeatEntry): BeatEntry => {
  const next: BeatEntry = { ...entry };
  if (entry.location) {
    next.location = cloneLocation(entry.location);
  }
  return next;
};


const sortBeatEntries = (beat: BeatEntry[], characters: PublicCharacter[]) => {
  const order = new Map<string, number>();
  characters.forEach((character, index) => {
    order.set(character.username, index);
    order.set(character.userId, index);
  });
  beat.sort((a, b) => {
    const keyA = a.username ?? a.userId ?? a.userID ?? '';
    const keyB = b.username ?? b.userId ?? b.userID ?? '';
    const indexA = order.get(keyA);
    const indexB = order.get(keyB);
    const scoreA = typeof indexA === 'number' ? indexA : Number.MAX_SAFE_INTEGER;
    const scoreB = typeof indexB === 'number' ? indexB : Number.MAX_SAFE_INTEGER;
    return scoreA - scoreB;
  });
};

const buildTargetEntry = (
  target: PublicCharacter,
  action: string,
  rotation: string,
  rotationSource: ActionListItem['rotationSource'],
  priority: number,
  interaction: ActionListItem['interaction'],
  attackDamage: number | undefined,
  attackKbf: number | undefined,
  cardId: string | undefined,
  passiveCardId: string | undefined,
  seed: { damage: number; location: { q: number; r: number }; facing: number },
): BeatEntry => {
  const entry: BeatEntry = {
    username: target.username ?? target.userId,
    action,
    rotation,
    priority,
    damage: seed.damage,
    location: cloneLocation(seed.location),
    facing: seed.facing,
    calculated: false,
  };
  if (rotationSource) {
    entry.rotationSource = rotationSource;
  }
  if (interaction) {
    entry.interaction = interaction;
  }
  if (Number.isFinite(attackDamage)) {
    entry.attackDamage = attackDamage;
  }
  if (Number.isFinite(attackKbf)) {
    entry.attackKbf = attackKbf;
  }
  if (cardId) {
    entry.cardId = cardId;
  }
  if (passiveCardId) {
    entry.passiveCardId = passiveCardId;
  }
  return entry;
};

export const applyActionSetToBeats = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  targetUserId: string,
  actionList: ActionListItem[],
  play: unknown[] = [],
): BeatEntry[][] => {
  const target = characters.find((character) => character.userId === targetUserId);
  if (!target || !actionList.length) {
    console.log(LOG_PREFIX, 'skip', {
      targetUserId,
      hasTarget: Boolean(target),
      actionCount: actionList.length,
      beatsLength: beats.length,
    });
    return beats;
  }

  const updated = beats.map((beat) => beat.map((entry) => cloneEntry(entry)));
  const beforeLength = updated.length;
  const resolvedIndex = getTimelineResolvedIndex(updated);
  const scanStartIndex = Math.max(0, resolvedIndex + 1);
  let startIndex = updated.length;

  for (let i = scanStartIndex; i < updated.length; i += 1) {
    const entry = findEntryForUser(updated[i], target);
    if (!entry) {
      startIndex = i;
      break;
    }
    if (isOpenBeatAction(entry.action)) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === updated.length) {
    startIndex = Math.max(scanStartIndex, updated.length);
  }

  let lastTargetEntry: BeatEntry | undefined;
  for (let i = startIndex - 1; i >= 0; i -= 1) {
    const entry = findEntryForUser(updated[i], target);
    if (!entry) continue;
    lastTargetEntry = entry;
    break;
  }

  const seed = {
    damage: typeof lastTargetEntry?.damage === 'number' ? lastTargetEntry.damage : 0,
    location: cloneLocation(lastTargetEntry?.location ?? target.position),
    facing: normalizeFacing(lastTargetEntry?.facing, target.facing ?? 0),
  };

  const actions = actionList.map((item, index) => ({
    action: item.action,
    rotation: item.rotation,
    rotationSource: item.rotationSource,
    priority: item.priority,
    interaction: item.interaction,
    attackDamage: item.damage,
    attackKbf: item.kbf,
    comboStarter: index === 0 ? item.comboStarter : undefined,
    cardId: item.cardId,
    passiveCardId: item.passiveCardId,
  }));
  const lastIndex = startIndex + actions.length - 1;

  const ensureBeat = (index: number) => {
    while (updated.length <= index) {
      updated.push([]);
    }
  };

  actions.forEach((actionItem, offset) => {
    const index = startIndex + offset;
    ensureBeat(index);
    const beat = updated[index];
    const entry = findEntryForUser(beat, target);
    let primaryEntry: BeatEntry | null = null;
    if (entry) {
      entry.username = target.username ?? target.userId;
      entry.action = actionItem.action;
      entry.rotation = actionItem.rotation;
      if (actionItem.rotationSource) {
        entry.rotationSource = actionItem.rotationSource;
      } else if ('rotationSource' in entry) {
        delete entry.rotationSource;
      }
      entry.priority = actionItem.priority;
      if (actionItem.interaction) {
        entry.interaction = actionItem.interaction;
      } else if ('interaction' in entry) {
        delete entry.interaction;
      }
      if ('comboSkipped' in entry) {
        delete entry.comboSkipped;
      }
      if (actionItem.comboStarter) {
        entry.comboStarter = true;
      } else if ('comboStarter' in entry) {
        delete entry.comboStarter;
      }
      if (actionItem.cardId) {
        entry.cardId = actionItem.cardId;
      } else if ('cardId' in entry) {
        delete entry.cardId;
      }
      if (actionItem.passiveCardId) {
        entry.passiveCardId = actionItem.passiveCardId;
      } else if ('passiveCardId' in entry) {
        delete entry.passiveCardId;
      }
      if (Number.isFinite(actionItem.attackDamage)) {
        entry.attackDamage = actionItem.attackDamage;
      }
      if (Number.isFinite(actionItem.attackKbf)) {
        entry.attackKbf = actionItem.attackKbf;
      }
      entry.damage = seed.damage;
      entry.location = cloneLocation(seed.location);
      entry.facing = seed.facing;
      entry.calculated = false;
      primaryEntry = entry;
    } else {
      const nextEntry = buildTargetEntry(
        target,
        actionItem.action,
        actionItem.rotation,
        actionItem.rotationSource,
        actionItem.priority,
        actionItem.interaction,
        actionItem.attackDamage,
        actionItem.attackKbf,
        actionItem.cardId,
        actionItem.passiveCardId,
        seed,
      );
      if (actionItem.comboStarter) {
        nextEntry.comboStarter = true;
      }
      beat.push(nextEntry);
      primaryEntry = nextEntry;
    }

    if (primaryEntry) {
      for (let i = beat.length - 1; i >= 0; i -= 1) {
        const candidate = beat[i];
        if (candidate === primaryEntry) continue;
        if (matchesEntryForCharacter(candidate, target)) {
          beat.splice(i, 1);
        }
      }
    }

    if (beat.length > 1) {
      sortBeatEntries(beat, characters);
    }

    if (offset === 0 && play.length) {
      const primaryEntry = findEntryForUser(beat, target);
      if (primaryEntry) {
        primaryEntry.play = play.slice();
      }
    }
  });

  let removedCount = 0;
  for (let i = lastIndex + 1; i < updated.length; i += 1) {
    const beat = updated[i];
    if (!beat.length) continue;
    const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, target));
    if (filtered.length !== beat.length) {
      updated[i] = filtered;
      removedCount += beat.length - filtered.length;
    }
  }

  const afterLength = updated.length;
  console.log(LOG_PREFIX, 'apply', {
    targetUserId,
    resolvedIndex,
    scanStartIndex,
    startIndex,
    lastIndex,
    beforeLength,
    afterLength,
    removedCount,
    actionCount: actions.length,
    actions: actions.map((item) => item.action),
  });

  return updated;
};
