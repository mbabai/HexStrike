export const DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT = 6;

const normalizeSlotCount = (slotCount: number | null | undefined): number => {
  if (!Number.isFinite(slotCount)) return DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT;
  return Math.max(1, Math.floor(slotCount));
};

const clampSlotIndex = (slotIndex: number, slotCount: number): number => {
  const safeSlotCount = normalizeSlotCount(slotCount);
  return Math.max(0, Math.min(safeSlotCount - 1, slotIndex));
};

export const resolvePlayModalBeatSlotIndex = (
  beatIndex: number | null | undefined,
  startIndex: number | null | undefined,
  actionSetStep: number | null | undefined = null,
  slotCount: number | null | undefined = DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT,
): number | null => {
  const safeSlotCount = normalizeSlotCount(slotCount);
  if (Number.isFinite(actionSetStep)) {
    return clampSlotIndex(Math.max(0, Math.floor(actionSetStep as number) - 1), safeSlotCount);
  }
  if (!Number.isFinite(beatIndex) || !Number.isFinite(startIndex)) return null;
  const offset = Math.max(0, Math.round(beatIndex as number) - Math.round(startIndex as number));
  return clampSlotIndex(offset, safeSlotCount);
};
