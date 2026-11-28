import { cleanPresenceWork } from '../../shared/protocol/live-work.js';
import { cleanProjects, leadId } from '../../shared/protocol/hq.js';
import { cleanPitch } from '../../shared/pitch/clean.js';
import { cleanDraftBoards } from '../drafts/boards.js';
import { MAX_DEVICE_REQUESTS, MAX_OWNER_DEVICES, type CubbyAgent, type CubbyDevice, type CubbyDeviceRequest, type CubbyNodeFrame } from '../../shared/protocol/cubbies.js';
const roles = new Set(['lead', 'builder', 'reviewer', 'factory', 'paradev', 'direct']);
const statuses = new Set(['idle', 'working', 'needs-you', 'unknown']);
export const short = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max) : '';
const lines = (v: unknown) => Array.isArray(v) ? v.slice(0, 16).filter(x => typeof x === 'string').map(x => short(x, 300)) : [];
export function snapshot(raw: Record<string, unknown>, now: number): Extract<CubbyNodeFrame, {t: 'cubby.snapshot'}> | undefined {
  if (!Array.isArray(raw.agents) || raw.agents.length > 128 || typeof raw.observedAt !== 'number' || !Number.isFinite(raw.observedAt) || Math.abs(now - raw.observedAt) > 120_000) return;
  const agents: CubbyAgent[] = []; const ids = new Set<string>();
  for (const a of raw.agents) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^[\w:.-]{1,128}$/.test(a.id) || ids.has(a.id) || !roles.has(a.role) || !statuses.has(a.status)) return;
    ids.add(a.id);
    agents.push({ ...cleanPresenceWork(a), id: a.id, ...(leadId(a.lead) ? { lead: leadId(a.lead) } : {}),
      ...(typeof a.startedAt === 'number' && Number.isFinite(a.startedAt) ? { startedAt: a.startedAt } : {}), ...Object.fromEntries(['department', 'harnessRole', 'leadTitle'].filter(k => typeof a[k] === 'string').map(k => [k, short(a[k], 60)])), ...(a.designer === true ? { designer: true } : {}), tool: short(a.tool, 40), role: a.role, task: a.role === 'direct' ? `${short(a.tool, 40)} session` : short(a.task, 160), branch: short(a.branch, 120), status: a.status,
      ...(a.role !== 'direct' && typeof a.progress === 'string' ? { progress: short(a.progress, 600) } : {}),
      ...(a.role === 'factory' && typeof a.deadlineAt === 'number' && Number.isFinite(a.deadlineAt) ? { deadlineAt: a.deadlineAt } : {}) });
  }
  return { ...(raw.projects !== undefined ? { projects: cleanProjects(raw.projects) } : {}), ...(raw.pitch !== undefined ? { pitch: cleanPitch(raw.pitch) } : {}), ...(raw.draft !== undefined ? { draft: cleanDraftBoards(raw.draft) } : {}), t: 'cubby.snapshot', floorId: short(raw.floorId, 128), agents, observedAt: raw.observedAt, plan: lines(raw.plan), needsYou: lines(raw.needsYou), ...(typeof raw.error === 'string' ? { error: short(raw.error, 400) } : {}), ...(typeof raw.wake === 'string' && raw.wake.trim() ? { wake: short(raw.wake, 600) } : {}) };
}

/** The trusted devices and waiting requests a computer reports: bounded, plain fields only. */
export function devicesOf(raw: Record<string, unknown>, now: number) {
  if (!Array.isArray(raw.devices) || !raw.devices.length || raw.devices.length > MAX_OWNER_DEVICES ||
    !Array.isArray(raw.requests) || raw.requests.length > MAX_DEVICE_REQUESTS) return;
  const devices: CubbyDevice[] = [];
  for (const d of raw.devices) {
    if (!d || typeof d.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(d.fingerprint) || !Number.isSafeInteger(d.addedAt)) return;
    devices.push({ fingerprint: d.fingerprint, label: short(d.label, 40) || 'Device', addedAt: d.addedAt });
  }
  const requests: CubbyDeviceRequest[] = [];
  for (const q of raw.requests) {
    if (!q || typeof q.requestId !== 'string' || !/^[\w-]{1,128}$/.test(q.requestId) || typeof q.publicKey !== 'string' || !/^[A-Za-z0-9_-]{100,160}$/.test(q.publicKey) ||
      !Number.isSafeInteger(q.at) || Math.abs(now - q.at) > 15 * 60_000) return;
    requests.push({ requestId: q.requestId, label: short(q.label, 40) || 'Device', publicKey: q.publicKey, at: q.at });
  }
  return { devices, requests, note: typeof raw.note === 'string' && raw.note.trim() ? short(raw.note, 400) : undefined };
}
