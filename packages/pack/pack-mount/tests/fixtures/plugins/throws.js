// A pack row that cannot activate, proving a broken pack fails the mount
// loudly rather than composing a half-configured agent.
export const name = 'throws'

export function apply() {
  throw new Error('row refused to start')
}
