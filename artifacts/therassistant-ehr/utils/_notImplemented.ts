export function notImplemented(name: string, args: unknown[]): never {
  void args;
  throw new Error(`Utility "${name}" has been scaffolded but not implemented yet.`);
}
