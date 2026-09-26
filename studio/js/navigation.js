import { h, dialog } from './dom.js';
const KEY='ugs-navigation';
const scopes={scene2d:'Escenas 2D',scene3d:'Escenas 3D',art:'Arte: imágenes y pixel art',documents:'Documentos'};
const values={scene2d:1,scene3d:1,art:1,documents:1};
try { const saved=JSON.parse(localStorage.getItem(KEY)||'{}'); for(const key of Object.keys(values)) if(Number.isFinite(saved[key])) values[key]=Math.max(.1,Math.min(4,saved[key])); } catch {}
export const wheelSpeed=scope=>values[scope]||1;
export const wheelPixels=e=>Math.max(-2000,Math.min(2000,e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?500:1)));
export async function navigationSettings() {
  const pending={...values};
  const ok=await dialog('Velocidad de la rueda del ratón',b=>{
    b.append(h('p.help','Ajusta la sensibilidad del zoom por editor. 100 % es la velocidad original. Los valores se recuerdan en este navegador.'));
    for(const [key,label] of Object.entries(scopes)) {
      const number=h('input',{type:'number',min:10,max:400,step:10,value:Math.round(pending[key]*100),'aria-label':label+' (%)'});
      const range=h('input',{type:'range',min:10,max:400,step:10,value:Math.round(pending[key]*100),'aria-label':label});
      const update=v=>{pending[key]=Math.max(.1,Math.min(4,(Number.isFinite(v)?v:100)/100));range.value=number.value=Math.round(pending[key]*100);};
      range.oninput=()=>update(+range.value);number.onchange=()=>update(+number.value);
      b.append(h('div.field',h('label',label),h('div.row-actions',range,number,h('span','%'))));
    }
  },[{label:'Cancelar',value:false},{label:'Aplicar',kind:'primary',value:true}]);
  if(ok){Object.assign(values,pending);try{localStorage.setItem(KEY,JSON.stringify(values));}catch{}}
}
