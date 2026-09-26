import { PaintPanel } from '../studio/js/paint.js';
import { PaintDoc, ctx2d, makeCanvas } from '../studio/js/paintcore.js';
import { encodePaintDocument, decodePaintDocument } from '../studio/js/paintfile.js';

const host = document.getElementById('fixture');
const panel = new PaintPanel({editor:{on(){}, project:null}}, host);
const prefs = localStorage.getItem('ugs-paint');
let passed = 0, failed = 0;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
function test(name, fn) {
  const row = document.createElement('div');
  try { fn(); passed++; row.className='pass'; row.textContent='✓ '+name; }
  catch(e) { failed++; row.className='fail'; row.textContent='✗ '+name+': '+e.message; }
  document.getElementById('results').append(row);
}
async function asyncTest(name, fn) { let error; try { await fn(); } catch(e) { error=e; } test(name,()=>{if(error)throw error;}); }
function fresh(mode='pixel', bg=null) {
  panel.doc = new PaintDoc(24,24,{mode,background:bg});
  panel.tool='pencil'; panel.primary='#ff0000'; panel.secondary='#0000ff'; panel.alpha=1;
  Object.assign(panel.o,{size:1,pxSize:1,pxBrushSize:1,pxRound:false,opacity:1,flow:1,pixelPerfect:false,symX:false,symY:false,wrap:false,hardness:.8,strength:1,tol:0,contiguous:true,sampleAll:false});
  panel.stroke=null; panel.comp=null; return panel.doc;
}
function stroke(points, tool='pencil') {
  panel.tool=tool; panel.beginStroke({x:points[0][0],y:points[0][1]},panel.primary,{},false);
  for(const [x,y] of points.slice(1)) panel.strokeTo({x,y},{});
  panel.endStroke();
}
const pixel = (x,y) => Array.from(ctx2d(panel.doc.cel).getImageData(x,y,1,1).data);
test('Pincel disponible en pixel art',()=>{fresh(); assert(panel.toolOk('brush'),'desaparece al crear pixel art');});
test('Repintar el mismo recorrido conserva cada píxel',()=>{fresh(); const path=[[3,3],[9,3],[9,9],[3,9],[3,3],[9,3],[9,9],[3,9],[3,3]]; stroke(path); for(let n=3;n<=9;n++) assert(pixel(n,3)[3]===255&&pixel(9,n)[3]===255&&pixel(n,9)[3]===255&&pixel(3,n)[3]===255,'hueco en el contorno');});
test('Píxel perfecto conserva intersecciones ya pintadas en el trazo',()=>{fresh();panel.o.pixelPerfect=true;stroke([[5,5],[6,5],[7,5],[7,6],[6,6],[5,6],[5,5],[4,5]]);assert(pixel(5,5)[3]===255,'borró la primera visita al píxel');});
test('Píxel perfecto limpia una esquina nueva',()=>{fresh();panel.o.pixelPerfect=true;stroke([[2,2],[3,2],[3,3]]);assert(pixel(3,2)[3]===0&&pixel(2,2)[3]===255&&pixel(3,3)[3]===255,'esquina incorrecta');});
test('Píxel perfecto restaura el fondo de trazos anteriores',()=>{fresh('pixel','#0000ff');panel.o.pixelPerfect=true;stroke([[2,2],[3,2],[3,3]]);assert(pixel(3,2)[2]===255&&pixel(3,2)[3]===255,'borró el fondo');});
test('Sombreado no elimina esquinas aunque esté activado píxel perfecto',()=>{fresh('pixel','#555555');panel.o.pixelPerfect=true;stroke([[2,2],[3,2],[3,3]],'shade');assert(pixel(3,2)[0]!==85,'deshizo el sombreado');});
test('Pincel de píxeles pinta una punta de 3 × 3',()=>{fresh();panel.o.pxBrushSize=3;stroke([[5,5]],'brush');assert(pixel(4,4)[3]===255&&pixel(6,6)[3]===255&&pixel(3,3)[3]===0,'punta incorrecta');});
test('Punta redonda de píxeles conserva esquinas transparentes',()=>{fresh();panel.o.pxBrushSize=3;panel.o.pxRound=true;stroke([[5,5]],'brush');assert(pixel(4,4)[3]===0&&pixel(5,4)[3]===255,'no respeta la punta redonda');});
test('Lápiz semitransparente no acumula alfa en un mismo trazo',()=>{fresh();panel.alpha=.5;stroke([[2,2],[5,2],[2,2]]);assert(Math.abs(pixel(3,2)[3]-128)<=1,'alfa acumulada');});
test('Borrador respeta opacidad y no acumula borrado en el mismo trazo',()=>{fresh('pixel','#ff0000');panel.o.opacity=.5;stroke([[2,2],[5,2],[2,2]],'eraser');assert(Math.abs(pixel(3,2)[3]-128)<=1,'borró por completo');});
test('Bloquear alfa conserva transparencias parciales al pintar',()=>{fresh();panel.alpha=.5;stroke([[4,4]]);panel.alpha=1;panel.primary='#0000ff';panel.doc.curLayer.alphaLock=true;stroke([[4,4],[5,4]],'brush');assert(Math.abs(pixel(4,4)[3]-128)<=1&&pixel(5,4)[3]===0&&pixel(4,4)[2]===255,'cambió la transparencia');});
test('Bote respeta bloqueo de alfa parcial',()=>{fresh();panel.alpha=.5;stroke([[4,4]]);panel.alpha=1;panel.doc.curLayer.alphaLock=true;panel.fill({x:4,y:4},'#0000ff');assert(Math.abs(pixel(4,4)[3]-128)<=1,'relleno volvió opaco el píxel');});
test('Simetría y mosaico no duplican opacidad en el eje',()=>{fresh();panel.alpha=.5;panel.o.symX=true;panel.o.wrap=true;stroke([[-1,2],[0,2],[23,2]]);assert(pixel(0,2)[3]<=128&&pixel(23,2)[3]<=128,'solapamiento más oscuro');});
test('Selección limita el lápiz y el borrador',()=>{const d=fresh();d.selection=makeCanvas(24,24);ctx2d(d.selection).fillRect(4,4,2,2);stroke([[0,4],[9,4]]);assert(pixel(3,4)[3]===0&&pixel(4,4)[3]===255&&pixel(6,4)[3]===0,'pintó fuera de selección');panel.o.opacity=.5;stroke([[0,4],[9,4]],'eraser');assert(Math.abs(pixel(4,4)[3]-128)<=1,'borrador no respeta opacidad');});
test('Pincel Foto respeta el alfa del color',()=>{fresh('photo');panel.o.size=8;panel.alpha=.5;stroke([[8,8]],'brush');assert(pixel(8,8)[3]>0&&pixel(8,8)[3]<=128,'pincel ignora alfa');});
test('Dedo respeta agujeros de selecciones irregulares',()=>{const d=fresh('photo');const g=ctx2d(d.cel);g.fillStyle='#ff0000';g.fillRect(0,0,8,24);d.selection=makeCanvas(24,24);const sg=ctx2d(d.selection);sg.fillRect(0,0,24,24);sg.clearRect(10,10,4,4);panel.o.size=12;panel.smudgeStamp({prevQ:{x:4,y:12}},{x:12,y:12},12);assert(pixel(11,11)[3]===0,'pintó dentro del agujero no seleccionado');});
test('Desenfoque respeta bloqueo de alfa',()=>{const d=fresh('photo');ctx2d(d.cel).fillRect(9,9,2,2);d.curLayer.alphaLock=true;panel.filterStamp({x:10,y:10},12,'blur');assert(pixel(8,8)[3]===0&&pixel(9,9)[3]===255,'cambió alfa bloqueado');});
test('Deshacer y rehacer recuperan exactamente el trazo',()=>{const d=fresh();stroke([[2,2],[7,7]]);d.undoStep();assert(pixel(4,4)[3]===0,'no deshizo');d.redoStep();assert(pixel(4,4)[3]===255,'no rehizo');});
test('Paneles plegables conservan el estado al cambiar herramienta',()=>{fresh();panel.render();const section=host.querySelector('[data-section="palette"]');assert(section,'falta panel plegable');section.open=false;section.dispatchEvent(new Event('toggle'));panel.setTool('brush');panel.renderSide();assert(!host.querySelector('[data-section="palette"]').open,'perdió estado');});
test('Lápiz y pincel visibles tras crear documento',()=>{fresh();panel.render();assert(host.querySelector('[aria-label="Pincel (B)"]')&&host.querySelector('[aria-label="Lápiz (N)"]'),'falta herramienta');});
test('Reemplazar color afecta solo a la selección del fotograma actual',()=>{const d=fresh('pixel','#ff0000');d.addFrame(true);d.frame=0;panel.o.replaceAllFrames=false;d.selection=makeCanvas(24,24);ctx2d(d.selection).fillRect(0,0,3,3);panel.replaceColor({x:1,y:1},'#0000ff');assert(pixel(1,1)[2]===255&&pixel(4,4)[0]===255,'ignoró selección');d.frame=1;assert(pixel(1,1)[0]===255,'cambió otro fotograma');});
test('Reemplazar en todos los fotogramas es opcional y reversible',()=>{const d=fresh('pixel','#ff0000');d.addFrame(true);panel.o.replaceAllFrames=true;panel.replaceColor({x:1,y:1},'#0000ff');d.frame=0;assert(pixel(1,1)[2]===255,'faltó un fotograma');d.undoStep();assert(pixel(1,1)[0]===255,'no restauró la animación');});
for(const kind of ['line','rect','ellipse']) test('Forma '+kind+' sin acumulación de alfa en esquinas',()=>{fresh();panel.o.opacity=.5;panel.o.shapeFill=true;panel.commitShape({kind,p0:{x:3,y:3},p1:{x:12,y:12},color:'#ff0000'});const bytes=ctx2d(panel.doc.cel).getImageData(0,0,24,24).data;assert(bytes.some((v,i)=>i%4===3&&v>0),'no dibujó');assert(bytes.every((v,i)=>i%4!==3||v<=128),'acumuló opacidad');});
test('Degradado respeta opacidad en ambos extremos',()=>{fresh('photo');panel.o.opacity=.5;panel.o.gradTransparent=false;panel.commitGradient({p0:{x:0,y:0},p1:{x:24,y:0}});assert(pixel(1,1)[3]===128&&pixel(22,1)[3]===128,'extremo opaco');});
test('Una cancelación del puntero revierte el trazo incompleto',()=>{fresh();panel.render();const c=panel.canvas;const real=c.setPointerCapture;c.setPointerCapture=()=>{};panel.view={x:0,y:0,z:1};const r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:5,clientX:r.x+5,clientY:r.y+5,bubbles:true}));assert(pixel(5,5)[3]===255,'no comenzó');c.dispatchEvent(new PointerEvent('pointercancel',{pointerId:5,bubbles:true}));c.setPointerCapture=real;assert(pixel(5,5)[3]===0&&!panel.stroke,'trazo cancelado confirmado');});
test('Ctrl+S dentro de un campo pertenece a Arte',()=>{fresh();panel.visible=true;const original=panel.saveEditable;let saved=0;panel.saveEditable=()=>saved++;const input=document.createElement('input');host.append(input);input.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));panel.saveEditable=original;panel.visible=false;assert(saved===1,'no guardó la imagen');});
await asyncTest('Documento editable conserva capas, alfa, fotogramas y paleta',async()=>{const d=fresh();stroke([[2,2],[6,2]]);d.addLayer('Luces');ctx2d(d.cel).fillRect(5,5,2,2);d.curLayer.opacity=.4;d.curLayer.alphaLock=true;d.addFrame(true);d.frames[1].duration=240;const loaded=await decodePaintDocument(encodePaintDocument(d,['#ff0000','#0000ff']));assert(loaded.doc.layers.length===2&&loaded.doc.frames.length===2&&loaded.doc.frames[1].duration===240&&loaded.doc.curLayer.opacity===.4&&loaded.doc.curLayer.alphaLock,'propiedades perdidas');assert(ctx2d(loaded.doc.frames[0].cels[0]).getImageData(3,2,1,1).data[3]===255,'píxeles perdidos');assert(loaded.palette.join(',')==='#ff0000,#0000ff','paleta perdida');});
await asyncTest('Documento editable rechaza capas con URLs externas',async()=>{fresh();const data=JSON.parse(await encodePaintDocument(panel.doc,[]).text());data.frames[0].cels[0]='https://example.com/image.png';let rejected=false;try{await decodePaintDocument(new Blob([JSON.stringify(data)]));}catch{rejected=true;}assert(rejected,'aceptó URL externa');});
await asyncTest('Documento editable rechaza dimensiones y memoria excesivas',async()=>{fresh();const data=JSON.parse(await encodePaintDocument(panel.doc,[]).text());data.width=8192;data.height=8192;let rejected=false;try{await decodePaintDocument(new Blob([JSON.stringify(data)]));}catch{rejected=true;}assert(rejected,'no limitó memoria');});
await asyncTest('PNG con dimensiones discordantes no reemplaza el documento',async()=>{fresh();const data=JSON.parse(await encodePaintDocument(panel.doc,[]).text());data.width=25;let rejected=false;try{await decodePaintDocument(new Blob([JSON.stringify(data)]));}catch{rejected=true;}assert(rejected,'aceptó capa discordante');});
// No alterar las preferencias personales al ejecutar la batería.
await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
if(prefs===null)localStorage.removeItem('ugs-paint');else localStorage.setItem('ugs-paint',prefs);
document.getElementById('summary').textContent=`${passed} correctas · ${failed} fallidas`;
document.title=`Arte: ${passed} correctas, ${failed} fallidas`;
