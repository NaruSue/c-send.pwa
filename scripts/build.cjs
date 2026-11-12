const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
for(const name of ['index.html','version.js','service-worker.js','custom-api.js','manifest.webmanifest','news.json','connections.json'])if(!fs.statSync(path.join(root,name)).isFile())throw Error(`Missing ${name}`);
for(const name of ['manifest.webmanifest','news.json','connections.json'])JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));for(const icon of manifest.icons||[])if(!fs.existsSync(path.join(root,icon.src)))throw Error(`Missing icon: ${icon.src}`);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(match[1])&&match[2].trim())new vm.Script(match[2],{filename:'index.html inline script'});
for(const name of ['version.js','service-worker.js','custom-api.js'])new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name});
fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist);for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(['.git','.github','.gitignore','.tmp','node_modules','dist','tests','scripts','package.json','package-lock.json'].includes(entry.name))continue;if(entry.isSymbolicLink())throw Error(`Unexpected symlink: ${entry.name}`);fs.cpSync(path.join(root,entry.name),path.join(dist,entry.name),{recursive:true})}console.log('Built and verified static PWA in dist/');
