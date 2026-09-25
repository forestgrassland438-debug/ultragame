'use strict';
/* Local conversion only: fixed formats, isolated temporary files, no shell or caller paths. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const INPUTS = new Set(['doc', 'docx', 'rtf', 'pptx', 'xlsx', 'xls', 'csv']);
const OUTPUTS = { doc: 'doc:MS Word 97', docx: 'docx:Office Open XML Text', rtf: 'rtf:Rich Text Format', pdf: 'pdf', pptx: 'pptx:Impress MS PowerPoint 2007 XML', xlsx: 'xlsx:Calc MS Excel 2007 XML', xls: 'xls:MS Excel 97', csv: 'csv:Text - txt - csv (StarCalc):44,34,76' };
let active = 0;
function findOffice() {
  const env = process.env;
  const candidates = [env.UG_OFFICE_PATH,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'UltraGameStudio', 'office', 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
    '/usr/bin/libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return candidates.find(file => file && fs.existsSync(file)) || null;
}
function status() { return { available: !!findOffice(), formats: Object.keys(OUTPUTS), local: true }; }
async function convert(bytes, from, to) {
  if (!INPUTS.has(from) || !Object.prototype.hasOwnProperty.call(OUTPUTS, to) || from === to) throw Object.assign(new Error('Conversión de formato no permitida'), { code: 400 });
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw Object.assign(new Error('El archivo debe ocupar entre 1 byte y 64 MB'), { code: 413 });
  const exe = findOffice();
  if (!exe) throw Object.assign(new Error('Necesita LibreOffice local. Ejecuta tools/setup-office.ps1 o configura UG_OFFICE_PATH.'), { code: 503 });
  if (active) throw Object.assign(new Error('Hay otra conversión en curso. Inténtalo al terminar.'), { code: 429 });
  active++;
  let dir;
  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ugs-office-'));
    const profile = path.join(dir, 'profile'), output = path.join(dir, 'output');
    await fs.promises.mkdir(path.join(profile, 'user'), { recursive: true });
    await fs.promises.mkdir(output);
    await fs.promises.writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinks" oor:op="fuse"><value>false</value></prop></item></oor:items>');
    const source = path.join(dir, 'document.' + from);
    await fs.promises.writeFile(source, bytes);
    await new Promise((resolve, reject) => {
      const child = spawn(exe, ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', OUTPUTS[to], '--outdir', output, source], { windowsHide: true, stdio: 'ignore' });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('close', code => { clearTimeout(timer); if (timedOut) reject(Object.assign(new Error('La conversión superó 60 segundos'), { code: 408 })); else if (code) reject(Object.assign(new Error('LibreOffice no pudo convertir este archivo'), { code: 422 })); else resolve(); });
    });
    const target = path.join(output, 'document.' + to);
    if (!fs.existsSync(target)) throw Object.assign(new Error('Este documento no se pudo convertir al formato elegido'), { code: 422 });
    const size = (await fs.promises.stat(target)).size;
    if (size > 128 * 1024 * 1024) throw Object.assign(new Error('El documento convertido supera 128 MB'), { code: 413 });
    return await fs.promises.readFile(target);
  } finally {
    active--;
    // dir is exclusively created here; never use caller-controlled paths for cleanup.
    if (dir && path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('ugs-office-')) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
module.exports = { status, convert };
