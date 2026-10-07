import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'
import { spawnSync } from 'node:child_process'
const out=resolve('.local/time-tests')
async function compile(dir) {
 for(const e of await readdir(dir,{withFileTypes:true})) {
  const path=dir+'/'+e.name
  if(e.isDirectory())await compile(path)
  else if(path.endsWith('.ts')) {
   const target=out+'/'+path.replace(/\.ts$/,'.js');await mkdir(dirname(target),{recursive:true})
   let code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
   code=code.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.js$3');await writeFile(target,code)
  }
 }
}
await compile('worker/time');await compile('shared');
for(const p of ['worker/policy.ts']) {const target=out+'/'+p.replace(/\.ts$/,'.js');await mkdir(dirname(target),{recursive:true});await writeFile(target,ts.transpileModule(await readFile(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText)}
const result=spawnSync(process.execPath,['--test','tests/time.test.mjs'],{stdio:'inherit'});process.exitCode=result.status
