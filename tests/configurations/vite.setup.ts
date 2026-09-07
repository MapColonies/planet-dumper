import 'reflect-metadata';
import { vi } from 'vitest';
import { buildStatefulMediatorMock } from '@tests/mocks/statefulMediator';

// global so every spec file gets a consistent, silent StatefulMediator instead of each
// re-declaring the same vi.mock factory (arstotzka-mediator is never exercised for real in tests)
vi.mock('@map-colonies/arstotzka-mediator', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  StatefulMediator: vi.fn().mockImplementation(buildStatefulMediatorMock),
}));
