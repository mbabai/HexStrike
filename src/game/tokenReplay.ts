import { BoardToken } from '../types';

const TIMELINE_DERIVED_TOKEN_TYPES = new Set([
  'fire-hex',
  'arrow',
  'ethereal-platform',
  'focus-anchor',
]);

export const buildReplaySeedTokens = (tokens: BoardToken[] = []): BoardToken[] => {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  return tokens
    .filter((token) => token && !TIMELINE_DERIVED_TOKEN_TYPES.has(`${token.type ?? ''}`))
    .map((token) => ({
      ...token,
      position: { q: token.position.q, r: token.position.r },
    }));
};

