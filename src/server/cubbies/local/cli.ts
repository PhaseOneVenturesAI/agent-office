/** Compatibility entry point: never inspect local files or start a retired bridge. */
export async function cubbyCommand(_argv: string[]): Promise<number> {
  console.error('removed: use `agent-office link <url>`');
  return 2;
}
