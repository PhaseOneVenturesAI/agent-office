import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeBriefDraft } from '../src/client/ui/department-draft.js';

const landed = { rev: 8, text: 'Submitted A', by: 'Owner', at: 1 };
test('acknowledging a saved snapshot preserves typing made while the save was pending', () => {
  const draft = { base: 7, text: 'New typing B', saving: 'Submitted A' };
  assert.deepEqual(acknowledgeBriefDraft(draft, landed), { base: 8, text: 'New typing B' });
  assert.equal(draft.text, 'New typing B');
});
test('an acknowledgment retires only an unchanged submitted draft', () => {
  assert.equal(acknowledgeBriefDraft({ base: 7, text: 'Submitted A', saving: 'Submitted A' }, landed), undefined);
});
test('an unrelated revision never rebases or discards the pending draft', () => {
  const draft = { base: 7, text: 'New typing B', saving: 'Submitted A' };
  assert.equal(acknowledgeBriefDraft(draft, { ...landed, text: 'Someone else changed it' }), draft);
  assert.equal(acknowledgeBriefDraft(draft, { ...landed, rev: 7 }), draft);
  assert.equal(acknowledgeBriefDraft(draft), draft);
});
