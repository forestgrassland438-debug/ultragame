/* Documento editable de Arte. Los PNG son datos locales: nunca se cargan URLs externas del archivo. */
import { PaintDoc, BLENDS, ctx2d } from './paintcore.js';
import {cleanVector} from './vector.js';

const MAX_BYTES = 64 * 1048576, MAX_PIXELS = 32 * 1048576;
const colors = (list) => Array.isArray(list) ? list.filter(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0,256) : [];
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function dimensions(w, h, layers, frames) {
  if (!integer(w,1,8192) || !integer(h,1,8192) || !integer(layers,1,128) || !integer(frames,1,256) || w*h*layers*frames > MAX_PIXELS) {
    throw new Error('El documento supera los límites de Arte (8192 px por lado y 128 MiB de píxeles entre todas las capas y fotogramas).');
  }
}

export function encodePaintDocument(doc, palette) {
  dimensions(doc.w, doc.h, doc.layers.length, doc.frames.length);
  const data = {
    format:'UltraGame Art', version:1, width:doc.w, height:doc.h, name:doc.name, mode:doc.mode,
    layer:doc.layer, frame:doc.frame, sheetCols:doc.sheetCols || 1, palette:colors(palette),vectorDraft:doc.vectorDraft?cleanVector(doc.vectorDraft,doc.w,doc.h):undefined,
    layers:doc.layers.map(({name,visible,opacity,blend,locked,alphaLock})=>({name,visible,opacity,blend,locked,alphaLock})),
    frames:doc.frames.map(fr=>({duration:fr.duration,cels:fr.cels.map(c=>c.toDataURL('image/png'))}))
  };
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  if (blob.size > MAX_BYTES) throw new Error('El archivo editable supera 64 MiB. Divide la animación o reduce sus dimensiones.');
  return blob;
}

function readPNG(src, w, h) {
  if (typeof src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) throw new Error('La capa no contiene un PNG local válido.');
  // Validar IHDR antes de decodificar: una cabecera con dimensiones enormes no debe asignar memoria.
  const header = atob(src.slice(22,66));
  const bytes = Uint8Array.from(header, c=>c.charCodeAt(0)), view = new DataView(bytes.buffer);
  if (bytes.length < 24 || view.getUint32(0)!==0x89504e47 || view.getUint32(4)!==0x0d0a1a0a || view.getUint32(12)!==0x49484452 || view.getUint32(16)!==w || view.getUint32(20)!==h) throw new Error('Las dimensiones de una capa no coinciden con el documento.');
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload=()=>{ if(img.naturalWidth===w && img.naturalHeight===h) resolve(img); else reject(new Error('Dimensiones PNG incorrectas.')); };
    img.onerror=()=>reject(new Error('No se pudo leer una capa PNG.')); img.src=src;
  });
}

export async function decodePaintDocument(file) {
  if (file.size > MAX_BYTES) throw new Error('El archivo editable supera 64 MiB.');
  let data;
  try { data=JSON.parse(await file.text()); } catch { throw new Error('El archivo no es un documento de Arte válido.'); }
  if (!data || data.format!=='UltraGame Art' || data.version!==1 || !Array.isArray(data.layers) || !Array.isArray(data.frames)) throw new Error('Formato o versión de Arte no compatible.');
  dimensions(data.width,data.height,data.layers.length,data.frames.length);
  if (!['pixel','photo'].includes(data.mode)) throw new Error('Modo de imagen no válido.');
  for(const layer of data.layers) if(!layer || typeof layer.name!=='string' || !Number.isFinite(layer.opacity) || layer.opacity<0 || layer.opacity>1 || !BLENDS.some(([b])=>b===layer.blend)) throw new Error('Propiedades de capa no válidas.');
  for(const frame of data.frames) if(!frame || !integer(frame.duration,10,5000) || !Array.isArray(frame.cels) || frame.cels.length!==data.layers.length) throw new Error('Fotogramas incompletos o duración no válida.');
  const doc=new PaintDoc(data.width,data.height,{mode:data.mode,name:typeof data.name==='string'?data.name.slice(0,120):'imagen'});
  for(let i=1;i<data.layers.length;i++) doc.addLayer();
  data.layers.forEach((l,i)=>Object.assign(doc.layers[i],{name:l.name.slice(0,120),opacity:l.opacity,blend:l.blend,visible:l.visible!==false,locked:l.locked===true,alphaLock:l.alphaLock===true}));
  for(let f=0;f<data.frames.length;f++) {
    if(f>0)doc.addFrame(false);
    doc.frames[f].duration=data.frames[f].duration;
    for(let l=0;l<data.layers.length;l++) ctx2d(doc.frames[f].cels[l]).drawImage(await readPNG(data.frames[f].cels[l],doc.w,doc.h),0,0);
  }
  doc.layer=integer(data.layer,0,doc.layers.length-1)?data.layer:0;
  doc.frame=integer(data.frame,0,doc.frames.length-1)?data.frame:0;
  doc.sheetCols=integer(data.sheetCols,1,doc.frames.length)?data.sheetCols:1;
  if(data.vectorDraft)doc.vectorDraft=cleanVector(data.vectorDraft,doc.w,doc.h);
  return {doc,palette:colors(data.palette)};
}
