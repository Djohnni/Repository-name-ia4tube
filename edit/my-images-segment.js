import {imageSubmissionFingerprint} from './my-images-submit.js?v=20261107-segment-v1';

export const SEGMENTS=Object.freeze(['Hamburgueria e lanchonete','Pizzaria','Restaurante','Padaria e confeitaria',
  'Vidraçaria e esquadrias','Material de construção','Salão de beleza e estética','Moda e acessórios',
  'Mercado e alimentos','Automóveis e oficinas','Imóveis e arquitetura','Esporte e academia','Serviços']);

export function normalizeImageSegment(value) {
  if(value===undefined)return undefined;
  if(typeof value!=='string')throw new Error('Escolha o segmento do negócio.');
  const text=value.trim().normalize('NFC');
  if(!text||text.length>80||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(text))throw new Error('Use até 80 caracteres no segmento.');
  return text;
}

// A bridge nonce changes when the app opens. A logo digest remembers the business
// across visits without storing its image or mixing different companies' choices.
export function createSegmentMemory({storage,hashLogo=logo=>imageSubmissionFingerprint(logo,'')}) {
  const key=async logo=>'ia4tube:my-images-segment:v1:'+await hashLogo(logo);
  return Object.freeze({
    async load(logo) {
      try {
        const saved=JSON.parse(storage.getItem(await key(logo))||'null');
        return saved?.schema===1?normalizeImageSegment(saved.segment):null;
      } catch {return null;}
    },
    async save(logo,segment) {
      const value=normalizeImageSegment(segment);
      if(!logo||value===undefined)return false;
      try {storage.setItem(await key(logo),JSON.stringify({schema:1,segment:value}));return true;}
      catch {return false;}
    },
  });
}
