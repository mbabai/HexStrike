import { ActionSetItem, BeatEntry, CharacterState } from '../types';

const DEFAULT_ACTION = 'E';

const cloneLocation = (location?: { q: number; r: number }) =>
  location ? { q: location.q, r: location.r } : { q: 0, r: 0 };

const normalizeFacing = (facing: unknown, fallback: number) => {
  if (typeof facing === 'number' && Number.isFinite(facing)) return facing;
  const parsed = typeof facing === 'string' ? Number(facing) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const findEntryForUser = (beat: BeatEntry, targetUsername: string, targetUserId: string) =>
  beat.find((entry) => entry.username === targetUsername || entry.username === targetUserId);

const normalizeBeatEntry = (entry: BeatEntry[number], characters: CharacterState[]) => {
  const character = characters.find(
    (candidate) => candidate.username === entry.username || candidate.userId === entry.username,
  );
  const damage = typeof entry.damage === 'number' ? entry.damage : 0;
  const priority = typeof entry.priority === 'number' ? entry.priority : 0;
  const location = cloneLocation(entry.location ?? character?.position);
  const facing = normalizeFacing(entry.facing, character?.facing ?? 0);
  const rotation =
    typeof entry.rotation === 'string' || typeof entry.rotation === 'number' ? `${entry.rotation}` : '';
  const calculated = Boolean(entry.calculated);
  return {
    ...entry,
    action: entry.action || DEFAULT_ACTION,
    rotation,
    priority,
    damage,
    location,
    facing,
    calculated,
  };
};

const sortBeatEntries = (beat: BeatEntry, characters: CharacterState[]) => {
  const order = new Map<string, number>();
  characters.forEach((character, index) => {
    order.set(character.username, index);
    order.set(character.userId, index);
  });
  beat.sort((a, b) => {
    const indexA = order.get(a.username);
    const indexB = order.get(b.username);
    const scoreA = typeof indexA === 'number' ? indexA : Number.MAX_SAFE_INTEGER;
    const scoreB = typeof indexB === 'number' ? indexB : Number.MAX_SAFE_INTEGER;
    return scoreA - scoreB;
  });
};

const buildTargetEntry = (
  target: CharacterState,
  action: string,
  rotation: string,
  priority: number,
  seed: { damage: number; location: { q: number; r: number }; facing: number },
) => ({
  username: target.username,
  action,
  rotation,
  priority,
  damage: seed.damage,
  location: cloneLocation(seed.location),
  facing: seed.facing,
  calculated: false,
});

export const applyActionSetToBeats = (
  beats: BeatEntry[],
  characters: CharacterState[],
  targetUserId: string,
  actionList: ActionSetItem[],
): BeatEntry[] => {
  const target = characters.find((character) => character.userId === targetUserId);
  if (!target || !actionList.length) return beats;

  const updated = beats.map((beat) => beat.map((entry) => normalizeBeatEntry(entry, characters)));
  let startIndex = updated.length;
  let lastTargetEntry: BeatEntry[number] | undefined;

  for (let i = 0; i < updated.length; i += 1) {
    const entry = findEntryForUser(updated[i], target.username, target.userId);
    if (!entry) {
      startIndex = i;
      break;
    }
    lastTargetEntry = entry;
    if (entry.action === DEFAULT_ACTION) {
      startIndex = i;
      break;
    }
  }

  const seed = {
    damage: typeof lastTargetEntry?.damage === 'number' ? lastTargetEntry.damage : 0,
    location: cloneLocation(lastTargetEntry?.location ?? target.position),
    facing: normalizeFacing(lastTargetEntry?.facing, target.facing ?? 0),
  };

  const actions = actionList.map((item, index) => ({
    action: item.action,
    rotation: index === 0 ? item.rotation : '',
    priority: item.priority,
  }));

  const ensureBeat = (index: number) => {
    while (updated.length <= index) {
      updated.push([]);
    }
  };

  actions.forEach((actionItem, offset) => {
    const index = startIndex + offset;
    ensureBeat(index);
    const beat = updated[index];
    const entry = findEntryForUser(beat, target.username, target.userId);
    if (entry) {
      entry.action = actionItem.action;
      entry.rotation = actionItem.rotation;
      entry.priority = actionItem.priority;
      entry.damage = seed.damage;
      entry.location = cloneLocation(seed.location);
      entry.facing = seed.facing;
      entry.calculated = false;
    } else {
      beat.push(buildTargetEntry(target, actionItem.action, actionItem.rotation, actionItem.priority, seed));
    }
    if (beat.length > 1) {
      sortBeatEntries(beat, characters);
    }
  });

  const lastIndex = startIndex + actions.length - 1;
  for (let i = lastIndex + 1; i < updated.length; i += 1) {
    const beat = updated[i];
    if (!beat.length) continue;
    const filtered = beat.filter((entry) => entry.username !== target.username && entry.username !== target.userId);
    if (filtered.length !== beat.length) {
      updated[i] = filtered;
    }
  }

  return updated;
};
