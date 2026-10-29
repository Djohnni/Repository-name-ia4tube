import {IMAGE_CATEGORIES,categoryCounts,normalizeCategoryId} from './image-categories.js?v=20261029-products-first';

// A browsing control only: it never opens or submits an order.
export function createImageCategoryMenu({buttons,dialog,items,onSelect,onOpenChange=()=>{}}) {
  const triggers=[...buttons];
  const search=dialog.querySelector('#image-category-search');
  const list=dialog.querySelector('#image-category-list');
  let categoryId='all',query='',lastTrigger=null;
  const labelFor=id=>IMAGE_CATEGORIES.find(category=>category.id===id)?.label || 'Todas as imagens';
  function render() {
    const counts=categoryCounts(items(),search.value);
    list.replaceChildren();
    for (const category of [{id:'all',label:'Todas as imagens'},...IMAGE_CATEGORIES]) {
      const count=counts[category.id] || 0;
      if (search.value.trim() && !count && category.id!=='all') continue;
      const button=document.createElement('button');
      button.type='button';button.className='category-item';button.dataset.category=category.id;
      button.setAttribute('aria-pressed',String(categoryId===category.id));
      button.setAttribute('aria-label',`${category.label}, ${count} ${count===1?'imagem':'imagens'}`);
      button.disabled=!count;
      const label=document.createElement('span');label.textContent=category.label;
      const total=document.createElement('small');total.textContent=String(count);total.setAttribute('aria-hidden','true');
      button.append(label,total);
      button.addEventListener('click',()=>select(category.id));
      list.append(button);
    }
    if (search.value.trim()) {
      const result=document.createElement('p');result.className='category-result';result.setAttribute('role','status');
      result.textContent=counts.all ? `${counts.all} ${counts.all===1?'imagem encontrada':'imagens encontradas'}` : 'Nenhuma imagem encontrada. Tente outra palavra.';
      list.append(result);
    }
  }
  function select(id) {
    categoryId=normalizeCategoryId(id);query=search.value.trim();
    dialog.close();
    onSelect({categoryId,query});
  }
  function sync({mediaKind,categoryId:nextCategory='all',query:nextQuery=''}) {
    categoryId=normalizeCategoryId(nextCategory);query=String(nextQuery || '');
    const active=categoryId!=='all' || !!query;
    for (const button of triggers) {
      button.hidden=mediaKind!=='image';
      button.dataset.categoryActive=String(active);
      button.setAttribute('aria-label',active ? `Categorias de imagens: ${labelFor(categoryId)}${query ? ', busca: '+query : ''}` : 'Categorias de imagens');
      button.title=active ? labelFor(categoryId) : 'Categorias de imagens';
    }
    if (mediaKind!=='image' && dialog.open) dialog.close();
    else if (dialog.open) render();
  }
  for (const button of triggers) button.addEventListener('click',()=>{
    if (button.hidden) return;
    lastTrigger=button;search.value=query;render();dialog.showModal();
    triggers.forEach(trigger=>trigger.setAttribute('aria-expanded','true'));
    onOpenChange(true);
  });
  search.addEventListener('input',render);
  search.addEventListener('keydown',event=>{
    if (event.key==='Enter') {
      event.preventDefault();
      if (categoryCounts(items(),search.value).all) select('all');
    }
  });
  dialog.querySelector('[data-category-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    triggers.forEach(trigger=>trigger.setAttribute('aria-expanded','false'));
    onOpenChange(false);lastTrigger?.focus();
  });
  dialog.addEventListener('click',event=>{
    if (event.target!==dialog) return;
    const bounds=dialog.getBoundingClientRect();
    if (event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom) dialog.close();
  });
  return {sync,isOpen:()=>dialog.open};
}
