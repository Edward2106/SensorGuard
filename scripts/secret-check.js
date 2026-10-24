import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const files=[...new Set([...tracked,...untracked])];
let failed=false;
for(const file of files){
  if (/(^|\/)\.env($|\.)/.test(file)&&!file.endsWith('.example') || /(^|\/)(logs|backups|scratch)\//.test(file)||/\.(archive|archive.gz|log)$/.test(file)) {console.error('Forbidden tracked file:',file);failed=true;continue;}
  let content;try{content=readFileSync(file,'utf8');}catch{continue;}
  if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|DD_API_KEY\s*=\s*[a-f0-9]{32}/.test(content)){console.error('Potential secret in:',file);failed=true;}
}
console.log('Scanned tracked files only; pattern scanning does not prove history is secret-free.');process.exitCode=failed?1:0;
