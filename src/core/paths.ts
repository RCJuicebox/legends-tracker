import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Whether `path` is `dir` or somewhere inside it. */
export function isInside(dir: string, path: string): boolean {
  const r = relative(resolve(dir), resolve(path))
  // A step up is ".." itself or "..\…"; a file named "..notes.txt" is inside.
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}
