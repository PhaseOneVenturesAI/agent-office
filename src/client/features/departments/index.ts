/** Department studios and the commons directory: E opens the relevant project workspace. */
import type { DeptPreset } from '../../../shared/protocol';
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
    hint: (it) => {
      const preset = roomPreset(it.label);
      if (preset) {
        const d = store.departments.departments.find((d) => d.preset === preset);
        return { k: `department-${preset}`, parts: [hintTitle(d?.name ?? preset), key('E', 'Open this department')] };
      }
      const n = store.departments.departments.length;
      return { k: 'departments', parts: [hintTitle('🏬 Departments'), aside(n ? `${n} on this floor` : 'briefs, roles, brand assets'), key('E', 'Open the departments')] };
    },
    // ctx.net lazily: the socket is wired after the features install (see main.ts).
    use: onE((it) => openDepartments(ctx.net, roomPreset(it.label))),
  });
}

function roomPreset(label?: string): DeptPreset | undefined {
  return label === 'marketing' || label === 'product' || label === 'review' ? label : undefined;
}
