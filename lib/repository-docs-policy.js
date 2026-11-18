import {lstat, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

// Reviewed repository evidence only, never a deployable source directory.
const approvedDocs = new Set(['assignment-scoped-access-review.md']);
export async function verifyRepositoryDocs(root) {
  const directory=resolve(root,'docs');
  const info=await lstat(directory);
  if(!info.isDirectory() || info.isSymbolicLink())throw new Error('Repository docs must be a regular directory.');
  for(const name of await readdir(directory)) {
    if(!approvedDocs.has(name))throw new Error(`Unexpected repository document: ${name}`);
    const file=await lstat(resolve(directory,name));
    if(!file.isFile() || file.isSymbolicLink())throw new Error(`Repository document must be a regular file: ${name}`);
  }
}
