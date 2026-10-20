// New-model options are additive. Server-side recipes own the actual price.
export function modelPrices(item, config) {
  return item?.prices || config?.prices || {};
}
export function chosenAnimal(item, value) {
  if (!item?.animalOptions) {
    if (value) throw new Error('Este modelo não usa escolha de animal.');
    return null;
  }
  if (typeof value !== 'string' || !Object.hasOwn(item.animalOptions,value)) {
    throw new Error('Escolha um dos animais disponíveis.');
  }
  return value;
}
export function createModelOptions(form, money) {
  const row = document.createElement('label');
  row.className = 'order-field';row.hidden = true;
  row.append(document.createTextNode('Escolha o animal'));
  const select = document.createElement('select');
  select.id = 'order-animal';select.name = 'animal';select.disabled = true;
  row.append(select);
  form.querySelector('.duration-field').before(row);
  const explanation = form.querySelector('.order-explanation[data-single-product]');
  const originalExplanation = explanation.textContent;
  let item = null,prices = {},active = false;
  function sync(busy = false) {
    select.disabled = busy || !active || !item?.animalOptions;
    for (const seconds of [10,20]) {
      const input = form.querySelector(`[name="duration"][value="${seconds}"]`);
      const valid = Number.isSafeInteger(prices[String(seconds)]);
      input.closest('label').hidden = active && !valid;
      input.disabled = busy || !active || !valid;
    }
  }
  function open(nextItem,config) {
    const sameItem = item?.id === nextItem.id;
    item = nextItem;active = item.recipe !== 'produtos';prices = modelPrices(item,config);
    row.hidden = !active || !item.animalOptions;
    select.required = active && Boolean(item.animalOptions);
    const previous = select.value;
    select.replaceChildren();
    for (const [id,label] of Object.entries(item.animalOptions || {})) {
      const option = document.createElement('option');option.value = id;option.textContent = label;
      option.defaultSelected = id === item.defaultAnimal;
      select.append(option);
    }
    select.value = sameItem && Object.hasOwn(item.animalOptions || {},previous) ? previous : (item.defaultAnimal || '');
    for (const seconds of [10,20]) form.querySelector(`#price-${seconds}`).textContent = money(prices[String(seconds)]);
    const selected = form.querySelector('[name="duration"]:checked');
    if (!Number.isSafeInteger(prices[selected?.value])) form.querySelector('[name="duration"][value="10"]').checked = true;
    explanation.textContent = item.prices ? 'Vídeo de 10 segundos com sua marca. Receba pelo WhatsApp.' : originalExplanation;
    sync();
    return active && !Number.isSafeInteger(prices['10']);
  }
  return {open,sync,animal:() => chosenAnimal(item,select.disabled && !item?.animalOptions ? null : select.value)};
}
