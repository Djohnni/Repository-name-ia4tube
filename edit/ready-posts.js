// Only the additive post models have a choice of still image or animation.
export const isReadyPost = item => item?.mediaKind === 'image' &&
  /^posts-prontos-(?:extra-)?(?:0[1-9]|[1-3][0-9]|40)-v1$/.test(item?.creativeTemplate || '');
export const canChooseModel=(item,canCreate)=>canCreate(item?.mediaKind || 'video')!==false;
export function feedItems(items,kind) {
  const selected = items.filter(item => kind === 'image' ? item.mediaKind === 'image' : item.mediaKind !== 'image');
  return selected.length === items.length ? items : selected;
}

export function createReadyPostOptions(form,money,canCreate=()=>null,canRecover=()=>false,
  {onOpenCombos=()=>{},onSelectionChange=()=>{}}={}) {
  const field = document.createElement('fieldset');field.className = 'output-kind-field';field.hidden = true;
  const legend = document.createElement('legend');legend.textContent = 'Formato';field.append(legend);
  const choices = document.createElement('div');choices.className = 'price-options';field.append(choices);
  const purchases = document.createElement('div');purchases.className='output-combo-actions';field.append(purchases);
  const inputs = {},quotes = {},labels = {},purchaseButtons={};
  let busy=false;
  for (const [kind,label] of [['image','Imagem'],['video','Vídeo · 10 segundos']]) {
    const choice = document.createElement('label');
    const input = document.createElement('input');input.type = 'radio';input.name = 'mediaKind';
    input.value = kind;input.checked = kind === 'image';input.defaultChecked = kind === 'image';input.disabled = true;
    const name = document.createElement('span');name.textContent = label;
    const quote = document.createElement('strong');
    choice.append(input,name,quote);choices.append(choice);inputs[kind] = input;quotes[kind] = quote;labels[kind]=choice;
    input.addEventListener('change',()=>{if(input.checked){for(const [other,value] of Object.entries(inputs))if(other!==kind)value.checked=false;onSelectionChange();}});
    const purchase=document.createElement('button');purchase.type='button';purchase.className='output-combo-action';
    purchase.textContent=kind==='image'?'Ver combos para criar imagens':'Ver combos para criar vídeos';
    purchase.addEventListener('click',()=>{if(active&&!busy&&!canRecover()&&canCreate(kind)===false)onOpenCombos(kind);});
    purchases.append(purchase);purchaseButtons[kind]=purchase;
  }
  const duration = form.querySelector('.duration-field');duration.before(field);
  let active = false,item = null;
  function sync(isBusy = false) {
    busy=isBusy;
    field.hidden = !active;
    duration.hidden = active || item?.recipe === 'produtos';
    for (const [kind,input] of Object.entries(inputs)) {
      labels[kind].hidden=false;input.disabled=busy||!active;
      purchaseButtons[kind].hidden=!active||canRecover()||canCreate(kind)!==false;
      purchaseButtons[kind].disabled=busy||!active;
    }
    if (active) for (const seconds of [10,20]) {
      const input = form.querySelector(`[name="duration"][value="${seconds}"]`);
      input.checked = seconds === 10;input.disabled = true;
    }
  }
  function open(nextItem,preferredKind='image') {
    item = nextItem;active = isReadyPost(item);
    inputs.image.checked = preferredKind!=='video';inputs.video.checked = preferredKind==='video';
    if (active) {
      quotes.image.textContent = money(item.outputPrices?.image);
      quotes.video.textContent = money(item.outputPrices?.video);
      form.querySelector('.order-explanation[data-single-product]').textContent = '';
    }
    sync();
    return active && (item.outputPrices?.image !== 990 ||
      !Number.isSafeInteger(item.outputPrices?.video) || item.outputPrices.video < 1990 || item.outputPrices.video > 2790);
  }
  return {open,sync,isEnabled:() => active,
    selected:() => active ? (inputs.video.checked ? 'video' : 'image') : undefined};
}
