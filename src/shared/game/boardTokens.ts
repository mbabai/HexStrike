import { getPrimaryTimingPhase, resolveActionTiming } from './timing';

export const FIRE_HEX_TOKEN_TYPE = 'fire-hex';
export const FLORA_HEX_TOKEN_TYPE = 'flora-hex';
export const DRUIDIC_PRESENCE_CARD_ID = 'druidic-presence';

export type LocalDirectionKey = 'F' | 'R' | 'BR' | 'B' | 'BL' | 'L';

const ROTATION_DIRECTION_BY_LABEL: Record<string, LocalDirectionKey> = {
  R1: 'R',
  R2: 'BR',
  3: 'B',
  L2: 'BL',
  L1: 'L',
};

export const getCommittedRotationDirectionKey = (rotationLabel: unknown): LocalDirectionKey =>
  ROTATION_DIRECTION_BY_LABEL[`${rotationLabel ?? ''}`.trim().toUpperCase()] ?? 'F';

export const getTokenPlacementWindowKey = (action: unknown, timing: unknown, fallback: string): string =>
  getPrimaryTimingPhase(resolveActionTiming(action, timing)) ?? fallback;

export const createFirePriorityPlacementTracker = () => {
  let currentWindowKey = '';
  const firePlacementsThisWindow = new Set<string>();

  return {
    setWindow(windowKey: unknown) {
      const normalizedKey = `${windowKey ?? ''}`.trim();
      if (normalizedKey === currentWindowKey) return;
      currentWindowKey = normalizedKey;
      firePlacementsThisWindow.clear();
    },
    noteFirePlacement(coordKey: string) {
      firePlacementsThisWindow.add(coordKey);
    },
    fireWinsAt(coordKey: string) {
      return firePlacementsThisWindow.has(coordKey);
    },
  };
};
