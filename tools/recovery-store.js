'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {isSafePath}=require('./path-safety');
const KEY=/^[A-Za-z0-9_-]{1,160}$/;
module.exports=function recoveryStore(workspace){
  const root=path.join(workspace,'.recovery');
  const safe=key=>{if(!KEY.test(key)||!isSafePath(workspace,root))throw Object.assign(new Error('Copia no válida'),{code:400});const p=path.join(root,key+'.json');if(!isSafePath(workspace,p))throw Object.assign(new Error('Ruta no válida'),{code:403});return p;};
  const read=key=>JSON.parse(fs.readFileSync(safe(key),'utf8'));
  const atomic=(file,bytes)=>{if(!isSafePath(workspace,file))throw Object.assign(new Error('Ruta no válida'),{code:403});const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);};
  return {
    save(key,meta,bytes){
      const target=safe(key);if(!['project','art','documents'].includes(meta.kind)||!bytes.length||bytes.length>64*1048576)throw Object.assign(new Error('Copia demasiado grande o tipo no válido'),{code:400});
      fs.mkdirSync(root,{recursive:true});const file=key+'-'+crypto.randomBytes(8).toString('hex')+'.bin';atomic(path.join(root,file),bytes);
      let prior;try{prior=read(key);}catch{}
      if(prior)atomic(safe(key+'-previous'),JSON.stringify({...prior,key:key+'-previous'}));
      const row={key,kind:meta.kind,name:String(meta.name||'Sin título').slice(0,120),projectId:String(meta.projectId||'').slice(0,80),modified:Date.now(),file,size:bytes.length};
      atomic(target,JSON.stringify(row));
      // Conservar la copia actual y la anterior. Nunca se borra un archivo referenciado por un índice.
      const retained=new Set(fs.readdirSync(root).filter(n=>n.endsWith('.json')).flatMap(n=>{try{return[JSON.parse(fs.readFileSync(path.join(root,n),'utf8')).file];}catch{return[];}}));
      for(const n of fs.readdirSync(root))if(n.startsWith(key+'-')&&n.endsWith('.bin')&&!retained.has(n)&&isSafePath(workspace,path.join(root,n)))fs.unlinkSync(path.join(root,n));
      return row;
    },
    list(){if(!fs.existsSync(root))return[];if(!isSafePath(workspace,root))throw Object.assign(new Error('Ruta no válida'),{code:403});return fs.readdirSync(root).filter(n=>n.endsWith('.json')).flatMap(n=>{try{const r=read(n.slice(0,-5));if(!KEY.test(r.key))return[];const {file,...meta}=r;return[meta];}catch{return[];}}).sort((a,b)=>b.modified-a.modified);},
    load(key){const row=read(key);if(!/^[A-Za-z0-9_-]+\.bin$/.test(row.file))throw Object.assign(new Error('Copia no válida'),{code:400});const file=path.join(root,row.file);if(!isSafePath(workspace,file))throw Object.assign(new Error('Ruta no válida'),{code:403});return fs.readFileSync(file);}
  };
};
