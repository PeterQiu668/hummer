export interface ParentLifetimeStream {
  resume(): void;
  once(event: 'end', listener: () => void): unknown;
}

export function bindParentStdinLifetime(
  environment: NodeJS.ProcessEnv,
  stdin: ParentLifetimeStream,
  quit: () => void,
): boolean {
  if (environment.HUMMER_EXIT_ON_STDIN_END !== '1') return false;
  delete environment.HUMMER_EXIT_ON_STDIN_END;
  stdin.resume();
  stdin.once('end', quit);
  return true;
}
