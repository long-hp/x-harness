/**
 * Path canonicalization for binding identity.
 *
 * A binding key must be the same string for every spelling of one directory,
 * because a session's `cwd` and the path a user bound may differ by trailing
 * slash, `..` segment, or symlink. The canon here is `fs.realpath` over an
 * absolute path, which is the same canon `dsh-workspace` applies to workspace
 * paths — the two must agree, or a directory registered as a workspace would
 * key its bindings under a different string than the sessions that run in it.
 *
 * @module @deepseek-ai/dsh-pack-binding/paths
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

/**
 * Canonicalize a directory path for use as a binding key.
 * @param path - the directory to canonicalize; a relative path resolves against the process working directory.
 * @returns the canonical absolute path.
 * @throws when the directory does not exist or cannot be resolved.
 */
export async function canonicalPath(path: string): Promise<string> {
  return await realpath(isAbsolute(path) ? path : resolve(path))
}

/**
 * Canonicalize a path for a read that must not fail.
 *
 * A directory that no longer exists can hold no bindings, so a read answers
 * "nothing bound" instead of propagating the filesystem error into session
 * creation.
 * @param path - the directory to canonicalize.
 * @returns the canonical absolute path, or `undefined` when it cannot be resolved.
 */
export async function readableCanonicalPath(path: string): Promise<string | undefined> {
  try {
    return await canonicalPath(path)
  } catch {
    return undefined
  }
}
