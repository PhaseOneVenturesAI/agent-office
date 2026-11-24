// Runs only against the newly generated scratch image; every mutation is restored.
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyImage } from '../../src/server/claude-qa/runtime.js';
const root=process.argv[2],file=path.join(root,'etc/hosts'),bytes=readFileSync(file),mode=lstatSync(file).mode&0o777;
verifyImage(root);
try {
 chmodSync(file,0o644);writeFileSync(file,'TAMPERED');assert.throws(()=>verifyImage(root));writeFileSync(file,bytes);
 chmodSync(file,0o666);assert.throws(()=>verifyImage(root));chmodSync(file,mode);
 renameSync(file,`${file}.saved`);symlinkSync('hosts.saved',file);assert.throws(()=>verifyImage(root));rmSync(file);renameSync(`${file}.saved`,file);
 writeFileSync(path.join(root,'unexpected'),'extra');assert.throws(()=>verifyImage(root));rmSync(path.join(root,'unexpected'));
 verifyImage(root);console.log(JSON.stringify({hashTamperRefused:true,writableFileRefused:true,symlinkRefused:true,extraFileRefused:true,imageRestored:true}));
} finally {
 if(lstatSync(file).isSymbolicLink()){rmSync(file);renameSync(`${file}.saved`,file);}
 chmodSync(file,0o644);writeFileSync(file,bytes);chmodSync(file,mode);rmSync(path.join(root,'unexpected'),{force:true});
}
