/** Live demo writes must never touch the protected seed deal or a sample id. */
export function sandboxTargetRefused(id: string) {
  return id === '355638664953' || id.startsWith('sample_');
}
