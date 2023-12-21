import { existsSync } from 'fs';
import { resolve } from 'path';

let projectRoot: string;
function findRoot(): string {
  if (projectRoot) return projectRoot;
  // Traverse upwards from __dirname until we find package.json
  let dir = __dirname;
  while (!existsSync(resolve(dir, 'package.json'))) {
    dir = resolve(dir, '..');
  }
  return (projectRoot = dir);
}

/**
 * Resolves a path relative to the project root
 * @returns
 */
export function fromRoot(...args: string[]): string {
  return resolve(findRoot(), ...args);
}
