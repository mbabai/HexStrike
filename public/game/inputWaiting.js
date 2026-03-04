import { getCharactersAtEarliestE, getTimelineEarliestEIndex } from './beatTimeline.js';
import { isFfaEnabled, isFfaPlayerOutAtBeat } from './ffaState.js';

const normalizeUserId = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  return trimmed || null;
};

const buildCharacterMaps = (characters) => {
  const byAnyKey = new Map();
  const byUserId = new Map();
  (Array.isArray(characters) ? characters : []).forEach((character) => {
    if (!character || typeof character !== 'object') return;
    const userId = normalizeUserId(character.userId);
    if (!userId) return;
    const username = normalizeUserId(character.username);
    byUserId.set(userId, character);
    byAnyKey.set(userId, userId);
    if (username) byAnyKey.set(username, userId);
  });
  return { byAnyKey, byUserId };
};

const addExpandedUser = (set, maps, rawUserId) => {
  const normalized = normalizeUserId(rawUserId);
  if (!normalized) return;
  const canonical = maps.byAnyKey.get(normalized) ?? normalized;
  set.add(canonical);
  const character = maps.byUserId.get(canonical);
  const username = normalizeUserId(character?.username);
  if (username) set.add(username);
};

const getPendingInteractionRecipientId = (interaction) => {
  if (!interaction || interaction.status !== 'pending') return null;
  if (interaction.type === 'discard') {
    return normalizeUserId(interaction.actorUserId) ?? normalizeUserId(interaction.targetUserId);
  }
  return normalizeUserId(interaction.actorUserId);
};

const getAtBatUsers = (publicState, maps) => {
  const result = new Set();
  const beats = Array.isArray(publicState?.beats) ? publicState.beats : [];
  const characters = Array.from(maps.byUserId.values());
  if (!beats.length || !characters.length) return result;
  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  let atBat = getCharactersAtEarliestE(beats, characters);
  if (isFfaEnabled(publicState)) {
    atBat = atBat.filter((character) => !isFfaPlayerOutAtBeat(publicState, character?.userId, earliestIndex));
  }
  atBat.forEach((character) => addExpandedUser(result, maps, character?.userId));
  return result;
};

const getPendingActionUsers = (publicState, maps) => {
  const result = new Set();
  const pendingActions = publicState?.pendingActions;
  if (!pendingActions || !Array.isArray(pendingActions.requiredUserIds)) return result;
  const submitted = new Set(Array.isArray(pendingActions.submittedUserIds) ? pendingActions.submittedUserIds : []);
  pendingActions.requiredUserIds.forEach((userId) => {
    if (submitted.has(userId)) return;
    addExpandedUser(result, maps, userId);
  });
  return result;
};

export const isCharacterInUserSet = (userSet, character) => {
  if (!(userSet instanceof Set) || !character) return false;
  const userId = normalizeUserId(character.userId);
  const username = normalizeUserId(character.username);
  return (userId && userSet.has(userId)) || (username && userSet.has(username));
};

export const getActionPhaseUserIds = (publicState) => {
  const maps = buildCharacterMaps(publicState?.characters);
  const result = new Set();
  if (!maps.byUserId.size) return result;
  const interactions = Array.isArray(publicState?.customInteractions) ? publicState.customInteractions : [];
  const pendingInteraction = interactions.find((interaction) => interaction?.status === 'pending') ?? null;
  if (pendingInteraction) return result;
  const pendingActions = publicState?.pendingActions;
  if (pendingActions && Array.isArray(pendingActions.requiredUserIds)) {
    pendingActions.requiredUserIds.forEach((userId) => addExpandedUser(result, maps, userId));
    if (result.size) return result;
  }
  return getAtBatUsers(publicState, maps);
};

export const getActionSelectionUserIds = (publicState) => {
  const maps = buildCharacterMaps(publicState?.characters);
  const result = new Set();
  if (!maps.byUserId.size) return result;
  const interactions = Array.isArray(publicState?.customInteractions) ? publicState.customInteractions : [];
  const pendingInteraction = interactions.find((interaction) => interaction?.status === 'pending') ?? null;
  if (pendingInteraction) return result;
  const pendingActionUsers = getPendingActionUsers(publicState, maps);
  if (pendingActionUsers.size) return pendingActionUsers;
  return getAtBatUsers(publicState, maps);
};

export const getWaitingForInputUserIds = (publicState) => {
  const maps = buildCharacterMaps(publicState?.characters);
  const result = new Set();
  if (!maps.byUserId.size) return result;
  const interactions = Array.isArray(publicState?.customInteractions) ? publicState.customInteractions : [];
  const pendingInteraction = interactions.find((interaction) => interaction?.status === 'pending') ?? null;
  if (pendingInteraction) {
    addExpandedUser(result, maps, getPendingInteractionRecipientId(pendingInteraction));
    return result;
  }
  const pendingActionUsers = getPendingActionUsers(publicState, maps);
  if (pendingActionUsers.size) return pendingActionUsers;
  return getAtBatUsers(publicState, maps);
};
