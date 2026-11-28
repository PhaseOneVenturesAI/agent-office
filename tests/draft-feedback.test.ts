import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { appendFeedback } from '../src/server/cubbies/local/feedback.js';
import { localDesign } from '../src/server/cubbies/local/design.js';
import { cleanDraftBoards } from '../src/server/drafts/boards.js';
import { boardFeedbackBytes, feedbackBytes, FEEDBACK_FULL } from '../src/server/drafts/feedback-budget.js';
import { BOARD_TOO_BIG, publication } from '../src/server/cubbies/publication.js';
import { draftsHandlers } from '../src/server/ws/handlers/drafts.js';
import type { CubbyAgent } from '../src/shared/protocol/cubbies.js';
import { DRAFT_LIMITS } from '../src/shared/protocol/drafts.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
import { boardFixture, png } from './support/draft-board.js';

import { kickoffDocuments } from '../src/server/drafts/documents.js';
const now = 1_800_000_000_000;
function fullBoard() {
  const card = (i: number) => ({ id: String(i).padStart(64, 'c'), title: 'T'.repeat(120), note: 'N'.repeat(DRAFT_LIMITS.note),
    status: 'approved', ...(i < DRAFT_LIMITS.images ? { image: { hash: i.toString(16).padStart(64, 'a'),
      mime: 'image/webp', width: 4000, height: 4000 } } : {}),
    feedback: Array.from({ length: i === 0 ? DRAFT_LIMITS.feedbackPerCard : i <= 21 ? 2 : 1 }, (_, n) => ({ id: `${i}-${n}`.padStart(128, 'n'), text: `${i}-${n}`.padEnd(12, 'x'), at: now })) });
  const boards = cleanDraftBoards({ ideas: Array.from({ length: DRAFT_LIMITS.ideas }, (_, i) => card(i)),
    screens: Array.from({ length: DRAFT_LIMITS.screens }, (_, i) => card(i + DRAFT_LIMITS.ideas)),
    decisions: Array(16).fill('D'.repeat(300)), plan: Array(16).fill('P'.repeat(300)),
    brand: { name: 'B'.repeat(80), tagline: 'T'.repeat(200), colors: Array(6).fill('#ffffff') } });
  boards.ideas[0].feedback[0].text += 'x'.repeat(DRAFT_LIMITS.feedbackBytes - boardFeedbackBytes(boards));
  assert.equal(boardFeedbackBytes(boards), DRAFT_LIMITS.feedbackBytes);
  return boards;
}

test('feedback budget counts UTF-8 and escaping with room for maximum IDs and timestamps', () => {
  const note = { id: 'n'.repeat(128), text: '界😀\n\t"\\', at: Number.MIN_SAFE_INTEGER };
  assert.equal(feedbackBytes(note), Buffer.byteLength(JSON.stringify(note.text)) - 2 + DRAFT_LIMITS.feedbackNoteOverhead);
  assert.ok(feedbackBytes(note) >= Buffer.byteLength(JSON.stringify(note)) + 1);
});

test('maximum ASCII board metadata and a full feedback budget publish under 64 KiB and kickoff exports every note', async t => {
  const f = boardFixture(t), boards = fullBoard();
  const frame = { t: 'cubby.snapshot' as const, floorId: f.def.id, observedAt: Date.now(), agents: [],
    plan: Array(16).fill('P'.repeat(240)), needsYou: Array(16).fill('N'.repeat(240)), draft: boards };
  const bytes = Buffer.byteLength(JSON.stringify(frame));
  assert.ok(bytes < 60 * 1024, `${bytes} bytes leaves at least 4 KiB of headroom`);
  t.diagnostic(`Full board frame: ${bytes} bytes; ${65536 - bytes} bytes below the cap`);
  assert.equal(publication(frame), frame);
  f.ws.frame(frame);
  const held = f.cubbies.draftBoards(f.setup.id, 'alice')!;
  assert.deepEqual([...held.ideas, ...held.screens].map(c => c.feedback), [...boards.ideas, ...boards.screens].map(c => c.feedback));
  const exported = kickoffDocuments('Board', boards)['docs/FEEDBACK.md'].toString();
  for (const card of [...boards.ideas, ...boards.screens]) for (const note of card.feedback) assert.ok(exported.includes(`${note.at}: ${note.text}`), note.id);
});

test('overflow frame keeps the last full office board and images while updating owner-visible error and roster', t => {
  const f = boardFixture(t); f.upload();
  const before = f.cubbies.draftBoards(f.setup.id, 'alice');
  for (const status of ['working', 'idle'] as const) {
    f.ws.frame(publication({ t: 'cubby.snapshot', floorId: f.def.id, observedAt: Date.now(), plan: [], needsYou: [],
      agents: [{ id: 'builder', role: 'builder', tool: 'codex', task: 'Design', branch: 'main', status }],
      draft: { ...f.boards, decisions: ['x'.repeat(65536)] } }));
    const cubby = f.cubbies.state(f.def.id, 'alice').cubbies[0];
    assert.equal(cubby.interior?.error, BOARD_TOO_BIG); assert.equal(cubby.interior?.agents[0].status, status);
    assert.deepEqual(f.cubbies.draftBoards(f.setup.id, 'alice'), before);
    assert.ok(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash));
  }
});

test('full board refuses new feedback without changing the Mac file, then accepts after local resolution', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'feedback-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, '.agent-office'));
  const boards = fullBoard(), file = path.join(dir, '.agent-office/feedback.json');
  writeFileSync(file, '{}');
  const note = { id: 'new-note', text: 'More contrast', at: Date.now() };
  assert.throws(() => appendFeedback(dir, boards, boards.ideas[0].id, note), new RegExp(FEEDBACK_FULL));
  assert.equal(readFileSync(file,'utf8'), '{}');
  boards.ideas[0].feedback = [];
  appendFeedback(dir, boards, boards.ideas[0].id, note);
  assert.equal(JSON.parse(readFileSync(file,'utf8'))[boards.ideas[0].id][0].id, note.id);
  assert.throws(() => appendFeedback(dir, boards, boards.ideas[0].id, note), /already saved/);
});
