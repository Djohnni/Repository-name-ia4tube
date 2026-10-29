// Browse the still-image catalogue without changing models, prices or orders.
export const IMAGE_CATEGORIES = Object.freeze([
  ['produtos','Produtos e combos'],
  ['interacao','Interação'],
  ['dias-semana','Dias da semana'],
  ['saudacoes','Bom dia e boa noite'],
  ['avisos','Avisos e horários'],
  ['equipe','Equipe'],
  ['datas','Datas comemorativas'],
  ['mascotes','Mascotes'],
  ['ambientes','Ambientes'],
].map(([id,label]) => Object.freeze({id,label})));

const ids = new Set(IMAGE_CATEGORIES.map(category => category.id));
const assignments = new Map();
function assign(prefix,numbers,...categories) {
  for (const number of numbers) assignments.set(`${prefix}${String(number).padStart(2,'0')}-v1`,Object.freeze(categories));
}

// The released model identity is stable even when its customer-facing title changes.
assign('posts-prontos-',Array.from({length:20},(_,index)=>index+1),'dias-semana');
assign('posts-prontos-',[6,12,18],'dias-semana','produtos');
assign('posts-prontos-',[21,22,23,27,28,29,30,33,34,35,36,37,38,39],'produtos');
assign('posts-prontos-',[24,25,26,32],'mascotes','produtos');
assign('posts-prontos-',[31],'interacao','produtos');
assign('posts-prontos-',[40],'datas','produtos');

assign('posts-prontos-extra-',[1,2,3,4,15],'interacao','produtos');
assign('posts-prontos-extra-',[5,6,7,8,13,14],'produtos');
assign('posts-prontos-extra-',[9,10],'ambientes');
assign('posts-prontos-extra-',[11,12],'mascotes','produtos');
assign('posts-prontos-extra-',[16,17,18,19,20],'datas','produtos');
assign('posts-prontos-extra-',[21,23],'saudacoes');
assign('posts-prontos-extra-',[22,24],'saudacoes','ambientes');
assign('posts-prontos-extra-',[25,26,27,29],'equipe');
assign('posts-prontos-extra-',[28,30,33,34,39],'avisos');
assign('posts-prontos-extra-',[31],'avisos','datas','ambientes');
assign('posts-prontos-extra-',[32,35],'avisos','ambientes');
assign('posts-prontos-extra-',[36,40],'interacao');
assign('posts-prontos-extra-',[37],'equipe','avisos');
assign('posts-prontos-extra-',[38],'datas');

const normalize = value => typeof value === 'string'
  ? value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim() : '';
const searchable = item => normalize([item?.title,item?.label,item?.phrase,item?.secondaryPhrase]
  .filter(value=>typeof value==='string').join(' '));
const termsFor = query => normalize(query).split(/\s+/u).filter(Boolean);
const matches = (item,terms) => {
  if (!terms.length) return true;
  const text = searchable(item);
  return terms.every(term=>text.includes(term));
};

export function normalizeCategoryId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : 'all';
  return ids.has(id) ? id : 'all';
}

export function imageCategories(item) {
  if (item?.mediaKind !== 'image') return [];
  const assigned = assignments.get(item.creativeTemplate);
  if (assigned) return [...assigned];
  // Future still images remain available in All, with a conservative useful group.
  const text = searchable(item),categories = [];
  if (/\b(segundou|tercou|quartou|quintou|sextou|sabadou|domingou|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/u.test(text)) categories.push('dias-semana');
  if (/\b(bom dia|boa noite)\b/u.test(text)) categories.push('saudacoes');
  if (/\b(comenta|comente|curta|curtir|convide|convidaria|opiniao|agradecimento|obrigado)\b/u.test(text)) categories.push('interacao');
  if (/\b(horario|horarios|atendimento|aberto|abertos|aberta|abertas|fechado|fechados|fechada|fechadas|manutencao|folga|ferias coletivas|voltamos|retornamos)\b/u.test(text)) categories.push('avisos');
  if (item.photoRole === 'person' || item.contentType === 'person' || /\b(funcionario|funcionarios|equipe|colaborador|colaboradores|boas.vindas|contratando|vaga|vagas)\b/u.test(text)) categories.push('equipe');
  if (/\b(halloween|black friday|natal|ano novo|reveillon|carnaval|pascoa|feriado|dia do|dia da|dia mundial|aniversario da empresa|aniversario da marca)\b/u.test(text)) categories.push('datas');
  if (typeof item.defaultAnimal === 'string' && item.defaultAnimal || /\b(mascote|mascotes|capivara|guaxinim|urso|coruja|gato chef)\b/u.test(text)) categories.push('mascotes');
  if (item.photoRole === 'place' || item.contentType === 'place' || /\b(fachada|salao|ambiente|ambientes|foto do local|conheca o local)\b/u.test(text)) categories.push('ambientes');
  if (item.photoRole === 'product' || item.contentType === 'product' || !categories.length) categories.push('produtos');
  return [...new Set(categories)];
}

export function filterImageItems(items,categoryId='all',query='') {
  const selected = normalizeCategoryId(categoryId),terms = termsFor(query);
  return (Array.isArray(items) ? items : []).filter(item=>item?.mediaKind === 'image' &&
    (selected === 'all' || imageCategories(item).includes(selected)) && matches(item,terms));
}

export function categoryCounts(items,query='') {
  const result = Object.fromEntries(['all',...ids].map(id=>[id,0]));
  for (const item of filterImageItems(items,'all',query)) {
    result.all++;
    for (const id of imageCategories(item)) result[id]++;
  }
  return result;
}
