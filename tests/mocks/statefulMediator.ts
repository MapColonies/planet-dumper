import { vi } from 'vitest';

// a regular function, not an arrow function: vi.fn().mockImplementation(...) invokes it via `new`
// when the mock constructor is called with `new StatefulMediator(...)`, and arrow functions can't be.
// Kept dependency-free (only imports `vi`) so it's safe to import from the global test setup file
// without eagerly loading production code that would defeat other files' own module mocks.
export function buildStatefulMediatorMock(): {
  reserveAccess: ReturnType<typeof vi.fn>;
  removeLock: ReturnType<typeof vi.fn>;
  createAction: ReturnType<typeof vi.fn>;
  updateAction: ReturnType<typeof vi.fn>;
} {
  return {
    reserveAccess: vi.fn().mockResolvedValue(undefined),
    removeLock: vi.fn().mockResolvedValue(undefined),
    createAction: vi.fn().mockResolvedValue({ actionId: 'action-1' }),
    updateAction: vi.fn().mockResolvedValue(undefined),
  };
}
