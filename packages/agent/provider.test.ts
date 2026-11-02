import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelPlanner } from './provider.ts';
test('model planner validates structured data and retains authoritative mode and brief', async () => {
  let body: any;
  const planner = new ModelPlanner({
    apiKey: 'test-only',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  title: 'City stories',
                  categoryName: 'Just Chatting',
                  tags: ['English'],
                  segments: [{ name: 'Welcome', goal: 'Introduce the walk', durationMin: 5 }],
                }),
              },
            ],
          },
        ],
      });
    },
  });
  const plan = await planner.plan('Explore city stories', 'documentary');
  assert.equal(plan.mode, 'documentary');
  assert.equal(plan.brief, 'Explore city stories');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
});
test('model planner rejects unknown shapes and incomplete output', async () => {
  const planner = new ModelPlanner({
    apiKey: 'test-only',
    fetch: async () =>
      Response.json({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '{"arbitrary":"command"}' }] },
        ],
      }),
  });
  await assert.rejects(planner.plan('test brief', 'chill'));
});
