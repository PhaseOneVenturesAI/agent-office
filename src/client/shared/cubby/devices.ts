import type { CubbyInfo } from '../../../shared/protocol/cubbies';
import type { OwnerDeviceKey } from './keys';
/** Legacy draft/pitch feedback still checks the pinned key until its link migration. */
export const deviceTrusted = (c: CubbyInfo | undefined, key: OwnerDeviceKey | undefined): boolean =>
  !!key && !!c?.interior?.ownerDevices?.some(d => d.fingerprint === key.fingerprint);
