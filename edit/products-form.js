import { createUploadField } from './upload-field.js?v=20261021-upload';

export const PRODUCT_PACKAGES = {2:3800,4:4800,6:5800,8:6800};

// The same fields feed the existing product renderer, in the customer's order.
export function createProductsForm({form,money}) {
  const section = form.querySelector('#products-options');
  const list = form.querySelector('#products-list');
  const single = [...form.querySelectorAll('[data-single-product]')];
  let enabled = false;
  const cards = [];
  const uploads = [];
  for (let index = 1; index <= 8; index++) {
    const card = document.createElement('fieldset');
    card.className = 'product-order-card';card.hidden = true;card.disabled = true;
    card.innerHTML = `<legend>Produto ${index}</legend>
      <label class="order-field">Foto do produto<input type="file" data-field="photo" accept="image/png,image/jpeg,image/webp" required></label>
      <label class="order-field">Nome na imagem<input data-field="name" maxlength="60" required placeholder="Ex.: X-SALADA"></label>
      <label class="order-field">Preço <span class="optional">opcional</span><input data-field="price" maxlength="30" inputmode="decimal" placeholder="Ex.: R$ 29,90"></label>
      <details class="product-extra"><summary>Ajustar fala e tempo</summary>
        <label class="consent-line"><input type="checkbox" data-field="speechEnabled"><span>Fala diferente do nome e preço</span></label>
        <label class="order-field" data-speech hidden>Texto completo da fala<textarea data-field="speech" maxlength="500" rows="3" disabled placeholder="Escreva tudo o que deve ser narrado, incluindo o nome e o preço se desejar."></textarea></label>
        <label class="order-field">Tempo deste produto<select data-field="seconds"><option value="4">4 segundos</option><option value="6">6 segundos</option><option value="8">8 segundos</option><option value="10">10 segundos</option></select></label>
      </details>`;
    card.querySelector('[data-field="speechEnabled"]').addEventListener('change',() => sync());
    uploads.push(createUploadField(card.querySelector('[data-field="photo"]'),{maxBytes:10 * 1024 * 1024,label:`Foto do produto ${index}`}));
    cards.push(card);list.append(card);
  }
  function count() {return Number(form.querySelector('[name="packageCount"]:checked')?.value || 2);}
  function sync(busy = false) {
    section.hidden = !enabled;section.disabled = !enabled || busy;
    single.forEach(group => {
      group.hidden = enabled;
      group.querySelectorAll('input,select,textarea,button').forEach(control => control.disabled = enabled || busy);
    });
    cards.forEach((card,index) => {
      const active = enabled && index < count();
      card.hidden = !active;card.disabled = !active || busy;
      const speechEnabled = card.querySelector('[data-field="speechEnabled"]').checked;
      card.querySelector('[data-speech]').hidden = !speechEnabled;
      const speech = card.querySelector('[data-field="speech"]');
      speech.disabled = !active || !speechEnabled || busy;speech.required = active && speechEnabled;
    });
    form.querySelector('#products-price').textContent = money(PRODUCT_PACKAGES[count()]);
  }
  form.querySelectorAll('[name="packageCount"]').forEach(input => input.addEventListener('change',() => sync()));
  function open(value) {enabled = value;sync();}
  async function payload() {
    const items = [],photos = [];
    for (const [index,card] of cards.slice(0,count()).entries()) {
      const field = key => card.querySelector(`[data-field="${key}"]`);
      const photo = await uploads[index].read();
      if (!photo) throw new Error(`Adicione a foto do produto ${index + 1}.`);
      photos.push(photo);
      const price = field('price').value.trim();
      if (price && !/^(?:R\$\s*)?(\d{1,7}|\d{1,3}(?:\.\d{3}){1,2})(?:,(\d{2}))?$/.test(price)) throw new Error(`Produto ${index + 1}: escreva somente o preço, por exemplo R$ 29,90. Use “Fala diferente” para dizer “a partir de”.`);
      if (price && Number(price.replace(/^R\$\s*/,'').split(',')[0].replaceAll('.','')) > 9999999) throw new Error('O preço do produto excede o limite permitido.');
      items.push({name:field('name').value.trim(),price,seconds:Number(field('seconds').value),
        speechOverrideEnabled:field('speechEnabled').checked,speechText:field('speechEnabled').checked ? field('speech').value.trim() : ''});
    }
    if (photos.reduce((sum,photo) => sum + atob(photo.data).length,0) > 24 * 1024 * 1024) throw new Error('As fotos dos produtos juntas devem ter até 24 MB. Escolha arquivos menores.');
    const text = id => form.querySelector(id).value.trim();
    return {productsVideo:{packageCount:count(),branch:text('#products-branch'),openingText:text('#products-opening'),openingSeconds:6,
      whatsapp:text('#products-whatsapp'),instagram:text('#products-instagram'),location:text('#products-location'),items},photos};
  }
  return {open,sync,payload,resetUploads:() => uploads.forEach(upload => upload.reset()),isEnabled:() => enabled};
}
