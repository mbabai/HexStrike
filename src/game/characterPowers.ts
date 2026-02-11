import { CharacterId } from '../types';

declare const require: (id: string) => any;

type CharacterPowerEffects = {
  maxHandSize?: number;
  attackDamageBonus?: number;
  drawOnKnockback?: number;
  damageReduction?: number;
  fireDamageImmune?: boolean;
  knockbackBonusPerTenDamage?: number;
  opponentDiscardReduction?: number;
};

type CharacterPowerEntry = {
  id: CharacterId;
  name: string;
  image?: string;
  powerText?: string;
  effects: CharacterPowerEffects;
};

type CharacterPowerData = { characters?: unknown[] };

const CHARACTER_POWER_DATA = require('../../public/characters/characters.json') as CharacterPowerData;

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeEffects = (value: unknown): CharacterPowerEffects => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const maxHandSize = toNumberOrNull(raw.maxHandSize);
  const attackDamageBonus = toNumberOrNull(raw.attackDamageBonus);
  const drawOnKnockback = toNumberOrNull(raw.drawOnKnockback);
  const damageReduction = toNumberOrNull(raw.damageReduction);
  const knockbackBonusPerTenDamage = toNumberOrNull(raw.knockbackBonusPerTenDamage);
  const opponentDiscardReduction = toNumberOrNull(raw.opponentDiscardReduction);
  return {
    maxHandSize: maxHandSize == null ? undefined : Math.max(0, Math.floor(maxHandSize)),
    attackDamageBonus: attackDamageBonus == null ? undefined : Math.max(0, Math.floor(attackDamageBonus)),
    drawOnKnockback: drawOnKnockback == null ? undefined : Math.max(0, Math.floor(drawOnKnockback)),
    damageReduction: damageReduction == null ? undefined : Math.max(0, Math.floor(damageReduction)),
    fireDamageImmune: Boolean(raw.fireDamageImmune),
    knockbackBonusPerTenDamage:
      knockbackBonusPerTenDamage == null ? undefined : Math.max(0, Math.floor(knockbackBonusPerTenDamage)),
    opponentDiscardReduction:
      opponentDiscardReduction == null ? undefined : Math.max(0, Math.floor(opponentDiscardReduction)),
  };
};

const normalizeEntry = (value: unknown): CharacterPowerEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? (raw.id.trim() as CharacterId) : '';
  if (!id) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const image = typeof raw.image === 'string' && raw.image.trim() ? raw.image.trim() : undefined;
  const powerText = typeof raw.powerText === 'string' && raw.powerText.trim() ? raw.powerText.trim() : undefined;
  return {
    id,
    name,
    image,
    powerText,
    effects: normalizeEffects(raw.effects),
  };
};

const CHARACTER_POWERS_BY_ID: Map<CharacterId, CharacterPowerEntry> = (() => {
  const map = new Map<CharacterId, CharacterPowerEntry>();
  const list = Array.isArray(CHARACTER_POWER_DATA?.characters) ? CHARACTER_POWER_DATA.characters : [];
  list.forEach((item) => {
    const normalized = normalizeEntry(item);
    if (!normalized) return;
    map.set(normalized.id, normalized);
  });
  return map;
})();

const getPowerEntry = (characterId: CharacterId | string | null | undefined): CharacterPowerEntry | null => {
  if (!characterId) return null;
  return CHARACTER_POWERS_BY_ID.get(characterId as CharacterId) ?? null;
};

export const getCharacterMaxHandSize = (characterId: CharacterId | string | null | undefined): number | null => {
  const value = getPowerEntry(characterId)?.effects?.maxHandSize;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : null;
};

export const getCharacterAttackDamageBonus = (characterId: CharacterId | string | null | undefined): number => {
  const value = getPowerEntry(characterId)?.effects?.attackDamageBonus;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
};

export const getCharacterDrawOnKnockback = (characterId: CharacterId | string | null | undefined): number => {
  const value = getPowerEntry(characterId)?.effects?.drawOnKnockback;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
};

export const getCharacterDamageReduction = (characterId: CharacterId | string | null | undefined): number => {
  const value = getPowerEntry(characterId)?.effects?.damageReduction;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
};

export const getCharacterOpponentDiscardReduction = (characterId: CharacterId | string | null | undefined): number => {
  const value = getPowerEntry(characterId)?.effects?.opponentDiscardReduction;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
};

export const isCharacterFireDamageImmune = (characterId: CharacterId | string | null | undefined): boolean =>
  Boolean(getPowerEntry(characterId)?.effects?.fireDamageImmune);

export const getCharacterKnockbackBonus = (
  characterId: CharacterId | string | null | undefined,
  accumulatedDamage: number,
  kbf: number,
): number => {
  if (!Number.isFinite(kbf) || kbf <= 0) return 0;
  const perTen = getPowerEntry(characterId)?.effects?.knockbackBonusPerTenDamage;
  if (!Number.isFinite(perTen) || (perTen as number) <= 0) return 0;
  const damage = Number.isFinite(accumulatedDamage) ? Math.max(0, Math.floor(accumulatedDamage)) : 0;
  const tiers = Math.floor(damage / 10);
  return Math.max(0, Math.floor((perTen as number) * tiers));
};

export const getCharacterPowerText = (characterId: CharacterId | string | null | undefined): string =>
  getPowerEntry(characterId)?.powerText ?? '';
