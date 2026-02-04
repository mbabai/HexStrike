const splitParagraphs = (text) => {
  const raw = `${text ?? ''}`;
  if (!raw.trim()) return [];
  return raw.split(/\r?\n\s*\r?\n/g).filter((paragraph) => paragraph.trim());
};

export const extractHandTriggerText = (text) => {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return '';
  return paragraphs.find((paragraph) => /in your hand/i.test(paragraph)) ?? '';
};
