export function normalizeProductPrice(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('Escreva somente o preço do produto, por exemplo R$ 29,90.');
  const price = value.normalize('NFC').trim();
  if (!price) return '';
  if (price.length > 30 || /[\x00-\x1f\x7f]/.test(price) || !/^(?:R\$\s*)?(\d{1,7}|\d{1,3}(?:\.\d{3}){1,2})(?:,(\d{2}))?$/.test(price) ||
      Number(price.replace(/^R\$\s*/,'').split(',')[0].replaceAll('.','')) > 9999999) {
    throw new Error('Escreva somente o preço do produto, por exemplo R$ 29,90.');
  }
  return price;
}
