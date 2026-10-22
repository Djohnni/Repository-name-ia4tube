export function normalizeProductDescription(value,{required = false} = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new Error('Descreva o produto com 5 a 500 caracteres.');
  const description = value.trim();
  if (!description && !required) return '';
  if (description.length < 5 || description.length > 500) throw new Error('Descreva o produto com 5 a 500 caracteres.');
  return description;
}
