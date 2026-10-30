// Only the additive post models have a choice of still image or animation.
export const isReadyPost = item => item?.mediaKind === 'image' &&
  /^posts-prontos-(?:extra-)?(?:0[1-9]|[1-3][0-9]|40)-v1$/.test(item?.creativeTemplate || '');
export const canChooseModel=(item,canCreate)=>isReadyPost(item)
  ? canCreate('image')!==false || canCreate('video')!==false : canCreate(item?.mediaKind || 'video')!==false;
export function feedItems(items,kind) {
  const selected = items.filter(item => kind === 'image' ? item.mediaKind === 'image' : item.mediaKind !== 'image');
  return selected.length === items.length ? items : selected;
}

export function createReadyPostOptions(form,money,canCreate=()=>null,canRecover=()=>false) {
  const field = document.createElement('fieldset');field.className = 'output-kind-field';field.hidden = true;
  const legend = document.createElement('legend');legend.textContent = 'Formato';field.append(legend);
  const choices = document.createElement('div');choices.className = 'price-options';field.append(choices);
  const inputs = {},quotes = {},labels = {};
  for (const [kind,label] of [['image','Imagem'],['video','Vídeo · 10 segundos']]) {
    const choice = document.createElement('label');
    const input = document.createElement('input');input.type = 'radio';input.name = 'mediaKind';
    input.value = kind;input.checked = kind === 'image';input.defaultChecked = kind === 'image';input.disabled = true;
    const name = document.createElement('span');name.textContent = label;
    const quote = document.createElement('strong');
    choice.append(input,name,quote);choices.append(choice);inputs[kind] = input;quotes[kind] = quote;labels[kind]=choice;
  }
  const duration = form.querySelector('.duration-field');duration.before(field);
  let active = false,item = null;
  function sync(busy = false) {
    field.hidden = !active;
    duration.hidden = active || item?.recipe === 'produtos';
    for (const [kind,input] of Object.entries(inputs)) {
      const unavailable=canCreate(kind)===false&&!canRecover();labels[kind].hidden=unavailable;
      input.disabled=busy||!active||unavailable;
    }
    if(active&&!canRecover()&&canCreate(inputs.video.checked?'video':'image')===false){
      if(canCreate('image')!==false){inputs.image.checked=true;inputs.video.checked=false;}
      else if(canCreate('video')!==false){inputs.image.checked=false;inputs.video.checked=true;}
    }
    if (active) for (const seconds of [10,20]) {
      const input = form.querySelector(`[name="duration"][value="${seconds}"]`);
      input.checked = seconds === 10;input.disabled = true;
    }
  }
  function open(nextItem) {
    item = nextItem;active = isReadyPost(item);
    inputs.image.checked = true;inputs.video.checked = false;
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
