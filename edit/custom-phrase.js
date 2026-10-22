const CLASSIC_SEXTOU_IDS = new Set([
  '4bb25879-a745-4577-812a-5a94286e324c',
  '7503ea91-b4f7-41eb-9869-be10f23df935',
]);

// Display the complete authorized block without changing the catalog snapshot.
export function modelMainPhrase(item) {
  const supplied = typeof item?.phrase === 'string' && item.phrase.trim();
  const fallback = item?.recipe === 'sextou' ? 'SEXTOU!' : item?.recipe === 'sabadou'
    ? item.copyLabel || item.label || 'SABADOU!' : 'Referência visual';
  const phrase = (supplied || fallback).trim().normalize('NFC').replace(/\s+/g,' ');
  return CLASSIC_SEXTOU_IDS.has(item?.id) && !/^SEXTOU\b/i.test(phrase) ? 'SEXTOU! ' + phrase : phrase;
}

export function normalizeCustomPhrase(value,{required = false} = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new Error('Escreva a frase principal em uma linha, com 2 a 60 caracteres.');
  const phrase = value.trim().normalize('NFC');
  if (!phrase && !required) return '';
  if (phrase.length < 2 || phrase.length > 60 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(phrase)) {
    throw new Error('Escreva a frase principal em uma linha, com 2 a 60 caracteres.');
  }
  return phrase;
}
