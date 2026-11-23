import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentsHandlers } from '../src/server/ws/handlers/departments.js';
import { roomDeskIds } from '../src/shared/department-rooms.js';

test('each department hires at its own available pod before old roster desks', () => {
  for (const preset of ['marketing', 'product', 'review'] as const) {
    const seats = roomDeskIds(preset);
    let hired: string | undefined;
    const floor = {
      project: { agentProviders: ['claude'] }, plan: { wing: 0 },
      departments: {
        composeLaunch: () => ({ role: { id: 'r', kind: 'implementation' }, prompt: 'scoped task' }),
        get: () => ({ id: 'd', preset, name: preset, desks: ['desk-16'] }),
        recordHire: () => {},
      },
      workers: {
        list: () => [], officeDefault: { provider: 'claude' },
        deskOccupied: (id: string) => id === seats[0],
        spawn: (desk: string) => { hired = desk; return { id: 'w', name: 'Preview' }; },
      },
    };
    const ctx = {
      floorOf: () => floor,
      signInFor: () => 'claude', withSignIn: (_c: unknown, _s: unknown, f: () => void) => f(),
      withFreshBase: (_c: unknown, _floors: unknown, f: () => void) => f(),
      toastFloor: () => {}, warn: (_c: unknown, error: string) => assert.fail(error),
    };
    departmentsHandlers['departments.launch'](ctx as never, { peer: { name: 'Test' }, floor: 'fixture' } as never, { t: 'departments.launch', id: 'd', role: 'r' });
    assert.equal(hired, seats[1]);
  }
});
