// Only the additive collection receives subject-aware fields. Legacy payloads stay unchanged.
export const isExtraReadyPost=item=>item?.mediaKind==='image' && /^posts-prontos-extra-(?:0[1-9]|[1-3][0-9]|40)-v1$/.test(item?.creativeTemplate||'');
const plain=value=>value && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const controls=/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/u;
const singleControls=/[\u0000-\u001f\u007f\u2028\u2029]/u;

export function normalizeTemplateFieldObject(value) {
  if (value===undefined) return undefined;
  if (!plain(value) || Object.keys(value).length>12) throw new Error('Confira as informações deste modelo.');
  const result={};
  for (const [key,raw] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || typeof raw!=='string') throw new Error('Confira as informações deste modelo.');
    const lines=raw.replace(/\r\n?/g,'\n');
    if (controls.test(lines)) throw new Error('Confira as informações deste modelo.');
    const clean=lines.trim().normalize('NFC');
    if (clean.length>500) throw new Error('Confira as informações deste modelo.');
    if (clean) result[key]=clean;
  }
  return Object.keys(result).length ? result : undefined;
}

export function normalizeExtraFields(item,value={}) {
  if (!isExtraReadyPost(item) || !plain(value)) throw new Error('Confira as informações deste modelo.');
  const fields=item.personalizationFields || [];
  if (Object.keys(value).some(key=>!fields.some(field=>field.key===key))) throw new Error('Confira as informações deste modelo.');
  const result={};
  for (const field of fields) {
    const raw=Object.hasOwn(value,field.key)?value[field.key]:'';
    if (typeof raw!=='string') throw new Error('Confira: '+field.label+'.');
    const lines=field.multiline?raw.replace(/\r\n?/g,'\n'):raw;
    if ((field.multiline?controls:singleControls).test(lines)) throw new Error('Confira: '+field.label+'.');
    const clean=lines.trim().normalize('NFC');
    if (field.required && !clean) throw new Error('Preencha: '+field.label+'.');
    if (clean.length>field.maxLength) throw new Error(field.label+': use até '+field.maxLength+' caracteres.');
    if (clean) result[field.key]=clean;
  }
  return Object.keys(result).length?result:undefined;
}

export function createExtraPostOptions(form,{onChange=()=>{}}={}) {
  let item=null,nodes=null,fieldItemId=null;
  const inputs=new Map();
  function init(){
    if(nodes)return;
    const node=id=>document.querySelector('#'+id);
    nodes={fields:node('extra-post-fields'),mode:node('order-photo-mode'),legend:node('order-photo-legend'),
      photoCaption:node('order-photo-caption'),photo:node('order-photo'),descriptionCaption:node('order-description-caption'),
      description:node('order-product-description'),descriptionNote:node('order-description-note'),price:node('order-product-price'),
      priceField:node('order-product-price-field')};
  }
  function open(nextItem){
    item=isExtraReadyPost(nextItem)?nextItem:null;
    if(!item)return false;
    if(!['product','place','person','none'].includes(item.photoRole) || typeof item.allowDescription!=='boolean' ||
      typeof item.allowProductPrice!=='boolean' || !Array.isArray(item.personalizationFields))return true;
    init();
    if(fieldItemId!==item.id){
      inputs.clear();nodes.fields.replaceChildren();
      const legend=document.createElement('legend');legend.textContent='Personalize';nodes.fields.append(legend);
      for(const field of item.personalizationFields){
        if(!field || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.key||'') || inputs.has(field.key) ||
          typeof field.label!=='string' || typeof field.required!=='boolean' || typeof field.multiline!=='boolean' ||
          !Number.isSafeInteger(field.maxLength) || field.maxLength<1 || field.maxLength>500)return true;
        const label=document.createElement('label');label.className='order-field';
        const caption=document.createElement('span');caption.textContent=field.label;
        const input=document.createElement(field.multiline?'textarea':'input');
        input.name='templateFields.'+field.key;input.id='extra-field-'+field.key;input.required=field.required;
        input.maxLength=field.maxLength;input.placeholder=field.placeholder||'';input.value='';input.defaultValue='';
        input.autocomplete='off';if(field.multiline)input.rows=3;
        input.addEventListener('input',onChange);label.append(caption,input);nodes.fields.append(label);inputs.set(field.key,input);
      }
      fieldItemId=item.id;
    }
    return false;
  }
  function sync(busy=false,{single=true}={}){
    if(!nodes)return;
    const role=item?.photoRole||'product',descriptionAllowed=single&&(!item||item.allowDescription);
    nodes.fields.hidden=!item||!single||!inputs.size;nodes.fields.disabled=busy||!item||!single;
    for(const input of inputs.values())input.disabled=busy||!item||!single;
    nodes.mode.hidden=!descriptionAllowed;
    nodes.legend.textContent=role==='place'?'Imagem do local':'Imagem do produto';
    nodes.photoCaption.hidden=!item||role!=='person';nodes.photoCaption.textContent='Foto da pessoa · opcional';
    nodes.photo.setAttribute('aria-label',role==='place'?'Foto do local':role==='person'?'Foto da pessoa opcional':'Foto do produto opcional');
    nodes.descriptionCaption.textContent=role==='place'?'Descreva o local':'Descreva o produto';
    nodes.description.placeholder=role==='place'?'Ex.: salão com mesas de madeira, cadeiras verdes, parede clara e plantas.':'Ex.: hambúrguer com pão de brioche, carne, queijo, alface e tomate.';
    nodes.descriptionNote.textContent=role==='place'?'O ambiente será ilustrativo, com base na sua descrição.':'A imagem criada será ilustrativa, com base na sua descrição.';
    nodes.priceField.hidden=!single||Boolean(item&&!item.allowProductPrice);
    nodes.price.disabled=busy||!single||Boolean(item&&!item.allowProductPrice);
  }
  function read(){
    return item?normalizeExtraFields(item,Object.fromEntries([...inputs].map(([key,input])=>[key,input.value]))):undefined;
  }
  function previewPhrase(){
    if(!item)return null;
    return (item.primaryTemplate||'').replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,(_match,key)=>{
      const value=inputs.get(key)?.value?.trim();
      return value||'';
    }).replace(/\s+/g,' ').replace(/,\s*([!.?])/g,'$1').trim();
  }
  function validateReference(photo,description){
    if(item?.photoRole==='place'&&item.requireReference&&!photo&&!description)throw new Error('Adicione uma foto ou descreva o local.');
  }
  return {open,sync,read,previewPhrase,validateReference,style:()=>item,isEnabled:()=>Boolean(item),
    allowPhoto:()=>!item||item.photoRole!=='none',allowDescription:()=>!item||item.allowDescription,
    allowProductPrice:()=>!item||item.allowProductPrice};
}
