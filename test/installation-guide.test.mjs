import test from 'node:test';
import assert from 'node:assert/strict';

// A missing feature is an assertion failure rather than a module-loader error.
const module = await import('../scripts/installation-guide.mjs').catch(() => null);
function guide(input) {
  assert.equal(typeof module?.installationGuide, 'function', 'installations need a truthful first-use guide');
  return module.installationGuide(input);
}

test('eye-only installation offers shooting guidance without claiming retouch tools', () => {
  const result = guide({names: ['photography-eye'], retouchReady: false});
  assert.deepEqual(result.tasks.map(task => task.id), ['scout']);
  assert.equal(result.retouchState, 'not-installed');
  assert.equal(result.hostCapabilities.imageGeneration, 'check-in-session');
});

test('installed retouch workflows remain pending until their actual dependencies are ready', () => {
  const result = guide({names: ['photo-retouch'], retouchReady: false});
  assert.deepEqual(result.tasks.map(task => task.id), ['retouch', 'series']);
  assert.equal(result.retouchState, 'needs-setup');
  assert.ok(result.tasks.every(task => task.localState === 'needs-setup'));
});

test('both installed skills provide three natural entry points and a new-chat next step', () => {
  const result = guide({names: ['photography-eye', 'photo-retouch'], retouchReady: true, version: '0.1.6'});
  assert.deepEqual(result.tasks.map(task => task.id), ['scout', 'retouch', 'series']);
  assert.equal(result.retouchState, 'ready');
  assert.equal(result.nextAction, 'new-chat');
  assert.ok(result.tasks.every(task => !task.prompt.includes('$')));
  assert.equal(result.hostCapabilities.vision, 'check-in-session');
  assert.equal(result.hostCapabilities.imageGeneration, 'check-in-session');
  assert.ok(result.message.includes(result.tasks[0].prompt));
  assert.ok(result.message.includes(result.tasks[1].prompt));
  assert.ok(result.message.includes(result.tasks[2].prompt));
});

test('unknown or duplicate installed names cannot advertise extra workflows', () => {
  const result = guide({names: ['photography-eye', 'photography-eye', 'unrelated'], retouchReady: true});
  assert.deepEqual(result.tasks.map(task => task.id), ['scout']);
  assert.equal(result.retouchState, 'not-installed');
});
