import type { Ctx } from '../office/context.js';
/** One selection policy shared by leads, helpers, boards and the gong. */
export const hqProjects = (ctx: Ctx, owner: string) => ctx.hq.mac?.projects(owner) ?? ctx.cubbies.hqProjects(owner) ?? [];
export const hqSources = (ctx: Ctx, owner: string) => ctx.hq.mac?.sources(owner) ?? ctx.cubbies.hqSources(owner);
