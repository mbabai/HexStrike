const CHARACTER_DATA_URL = '/public/characters/characters.json';
let catalogPromise = null;

const normalizeEffects = (effects) => {
  if (!effects || typeof effects !== 'object') return {};
  const toCount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
  };
  return {
    maxHandSize: toCount(effects.maxHandSize),
    attackDamageBonus: toCount(effects.attackDamageBonus),
    drawOnKnockback: toCount(effects.drawOnKnockback),
    damageReduction: toCount(effects.damageReduction),
    fireDamageImmune: Boolean(effects.fireDamageImmune),
    knockbackBonusPerTenDamage: toCount(effects.knockbackBonusPerTenDamage),
    opponentDiscardReduction: toCount(effects.opponentDiscardReduction),
  };
};

const normalizeCharacter = (entry, index) => {
  if (!entry || typeof entry !== 'object') {
    const id = `character-${index}`;
    return { id, name: id, image: '', powerText: '', effects: {} };
  }
  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `character-${index}`;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  const image = typeof entry.image === 'string' && entry.image.trim() ? entry.image.trim() : '';
  const powerText = typeof entry.powerText === 'string' && entry.powerText.trim() ? entry.powerText.trim() : '';
  return {
    id,
    name,
    image,
    powerText,
    effects: normalizeEffects(entry.effects),
  };
};

export const loadCharacterCatalog = async () => {
  if (!catalogPromise) {
    catalogPromise = fetch(CHARACTER_DATA_URL, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load characters: ${response.status}`);
      }
      const data = await response.json();
      const characters = Array.isArray(data?.characters)
        ? data.characters.map((entry, index) => normalizeCharacter(entry, index))
        : [];
      return {
        characters,
        byId: new Map(characters.map((character) => [character.id, character])),
      };
    });
  }
  return catalogPromise;
};
