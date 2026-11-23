/** The department directory by the north wall: it lists the floor's departments, and E opens them. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { openDepartments } from '../../ui/departments';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    departments: true;
  }
}

export function installDepartments(ctx: Ctx) {
  const { office } = ctx;
  // The directory's face lists the floor's departments as they change.
  const paint = () => office.departments.show(store.departments.departments);
  store.on('departments', paint);
  paint();

  ctx.interactions.define('departments', {
    reach: 5,
    hint: () => {
      const n = store.departments.departments.length;
      return { k: 'departments', parts: [hintTitle('🏬 Departments'), aside(n ? `${n} on this floor` : 'briefs, roles, brand assets'), key('E', 'Open the departments')] };
    },
    // ctx.net lazily: the socket is wired after the features install (see main.ts).
    use: onE(() => openDepartments(ctx.net)),
  });
}
