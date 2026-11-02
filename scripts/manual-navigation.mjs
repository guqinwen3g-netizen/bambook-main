export const manualNavigationRuntime = `
{
 const query=document.getElementById('q'),pages=[...document.querySelectorAll('.chapter')],links=[...document.querySelectorAll('.nav-item')],groups=[...document.querySelectorAll('.nav-part')];
 const selectedPage=()=>{let id='start';try{id=decodeURIComponent(location.hash.slice(1))||'start';}catch{}const node=document.getElementById(id);return node?.classList.contains('chapter')?node:node?.closest('.chapter')||document.getElementById('start');};
 const showSelected=()=>{const selected=selectedPage();pages.forEach(page=>page.hidden=page!==selected);links.forEach(link=>{link.hidden=false;link.classList.toggle('active',link.dataset.target===selected?.id);});groups.forEach(group=>group.hidden=false);document.getElementById('no-hit')?.remove();};
 const reveal=()=>{let id='';try{id=decodeURIComponent(location.hash.slice(1));}catch{}const node=id&&document.getElementById(id);if(node&&!node.classList.contains('chapter'))node.scrollIntoView({block:'start',behavior:'instant'});else window.scrollTo({top:0,behavior:'instant'});};
 addEventListener('hashchange',()=>{query.value='';showSelected();document.querySelector('.mobile-nav')?.removeAttribute('open');reveal();});
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-print]'))window.print();});
 query.addEventListener('input',()=>{const term=query.value.trim().toLowerCase();if(!term){showSelected();return;}let hits=0;pages.forEach(page=>{page.hidden=!page.textContent.toLowerCase().includes(term);if(!page.hidden)hits++;});links.forEach(link=>{const page=document.getElementById(link.dataset.target);link.hidden=!!page?.hidden;});groups.forEach(group=>group.hidden=![...group.querySelectorAll('.nav-item')].some(link=>!link.hidden));if(!hits&&!document.getElementById('no-hit')){const message=document.createElement('p');message.id='no-hit';message.className='empty';message.textContent='没有匹配的任务，请试试按钮或业务名称。';document.getElementById('content').prepend(message);}if(hits)document.getElementById('no-hit')?.remove();});
 showSelected();if(location.hash)reveal();
}
`;
