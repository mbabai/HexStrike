import { Beat, PendingInputs, Player, PlayerInput, Timeline } from '../types';

export const createTimeline = (beats: Beat[], currentBeatIndex = 0): Timeline => {
  const normalizedBeats = Array.isArray(beats)
    ? beats.map((beat, index) => ({
        ...beat,
        index,
      }))
    : [];
  const safeIndex = Math.max(0, Math.min(currentBeatIndex, Math.max(0, normalizedBeats.length - 1)));
  return { beats: normalizedBeats, currentBeatIndex: safeIndex };
};

export const getInputTargets = (beat: Beat, players: Player[]): string[] => {
  if (!beat || !beat.requiresInput) return [];
  const triggers = Array.isArray(beat.triggers) ? beat.triggers : [];
  const requireTrigger = triggers.find((trigger) => trigger.type === 'require_input');
  if (requireTrigger?.target === 'all_players') {
    return players.map((player) => player.id);
  }
  if (requireTrigger?.target === 'single_player') {
    return beat.playerId ? [beat.playerId] : [];
  }
  return beat.playerId ? [beat.playerId] : [];
};

export const advanceTimeline = (timeline: Timeline): Timeline => {
  const nextIndex = Math.min(timeline.currentBeatIndex + 1, Math.max(0, timeline.beats.length - 1));
  return {
    beats: timeline.beats.slice(),
    currentBeatIndex: nextIndex,
  };
};

export const collectInput = (timeline: Timeline, pending: PendingInputs, input: PlayerInput): PendingInputs => {
  if (!pending || pending.beatIndex !== timeline.currentBeatIndex) return pending;
  const submittedInputs = { ...pending.submittedInputs };
  if (input?.playerId) {
    submittedInputs[input.playerId] = input;
  }
  return { ...pending, submittedInputs };
};
