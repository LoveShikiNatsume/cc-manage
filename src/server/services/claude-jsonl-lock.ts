import { AsyncLocalStorage } from 'async_hooks';

type Operation<T> = () => T | Promise<T>;

const lockContext = new AsyncLocalStorage<boolean>();

let tail: Promise<void> = Promise.resolve();

export async function withClaudeJsonlWriteLock<T>(
  operation: Operation<T>,
): Promise<T> {
  if (lockContext.getStore()) {
    return operation();
  }

  const previous = tail;
  let release: () => void = () => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });

  tail = previous.catch(() => {}).then(() => current);
  await previous.catch(() => {});

  try {
    return await lockContext.run(true, operation);
  } finally {
    release();
  }
}
