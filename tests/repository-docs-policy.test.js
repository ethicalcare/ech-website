import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyRepositoryDocs} from '../lib/repository-docs-policy.js';
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'ech-doc-policy-'));try{await mkdir(join(root,'docs'));await run(root);}finally{await rm(root,{recursive:true,force:true});}}
test('approved repository document is accepted as a regular file',()=>fixture(async root=>{await writeFile(join(root,'docs','assignment-scoped-access-review.md'),'Fictional review');await verifyRepositoryDocs(root);}));
test('unknown repository document remains rejected',()=>fixture(async root=>{await writeFile(join(root,'docs','unreviewed.md'),'Fictional');await assert.rejects(verifyRepositoryDocs(root),/Unexpected repository document/);}));
test('approved document name cannot hide a directory or symlink',()=>fixture(async root=>{const p=join(root,'docs','assignment-scoped-access-review.md');await mkdir(p);await assert.rejects(verifyRepositoryDocs(root),/regular file/);await rm(p,{recursive:true});await writeFile(join(root,'target'),'Fictional');await symlink(join(root,'target'),p);await assert.rejects(verifyRepositoryDocs(root),/regular file/);}));
test('docs root cannot be a symlink',()=>fixture(async root=>{await rm(join(root,'docs'),{recursive:true});await mkdir(join(root,'other'));await symlink(join(root,'other'),join(root,'docs'));await assert.rejects(verifyRepositoryDocs(root),/regular directory/);}));
