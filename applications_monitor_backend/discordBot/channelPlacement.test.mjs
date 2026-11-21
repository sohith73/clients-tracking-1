import test from 'node:test';
import assert from 'node:assert/strict';
import { privateOverwrites, buildChannelName, categoryNameFor, createClientChannel, parseCategoryIndex, planCategory, slugify } from './channelPlacement.js';

const cat = (id, name) => ({ id, name, type: 4, parent_id: null });
const txt = (id, name, parent) => ({ id, name, type: 0, parent_id: parent });
const many = (parent, n) => Array.from({ length: n }, (_, i) => txt(`${parent}-${i}`, `c${i}`, parent));

test('slugify and channel names', () => {
  assert.equal(slugify('Sohith Réddy!'), 'sohith-reddy');
  assert.equal(buildChannelName({ clientNumber: 5788, name: 'Sohith' }), '5788-sohith');
  assert.equal(buildChannelName({ clientNumber: '', name: 'Sohith', userId: 'aabbccddeeff' }), 'sohith-eeff');
  assert.equal(buildChannelName({ name: '<@123> @everyone', clientNumber: 7 }), '7-123-everyone');
  assert.equal(buildChannelName({ name: '', email: 'jane.doe@x.com', clientNumber: 9 }), '9-jane-doe');
  assert.equal(buildChannelName({ name: '日本', clientNumber: 9 }), '9-client');
  assert.equal(buildChannelName({ clientNumber: 1, name: 'x'.repeat(300) }).length <= 100, true);
  assert.equal(buildChannelName({ clientNumber: 1, name: 'test', prefix: 'test' }), 'test-1-test');
});

test('category names and indexes', () => {
  assert.equal(categoryNameFor('clients', 1), 'clients');
  assert.equal(categoryNameFor('clients', 2), 'clients-2');
  assert.equal(parseCategoryIndex('Clients', 'clients'), 1);
  assert.equal(parseCategoryIndex('clients-12', 'clients'), 12);
  assert.equal(parseCategoryIndex('clients-1', 'clients'), null);
  assert.equal(parseCategoryIndex('clients-archive', 'clients'), null);
  assert.equal(parseCategoryIndex('engineers', 'clients'), null);
});

test('planCategory: none yet, room left, full, skips non-matching and gaps', () => {
  assert.deepEqual(planCategory({ channels: [], baseName: 'clients', max: 50 }), { categoryId: null, name: 'clients' });
  assert.deepEqual(planCategory({ channels: [cat('a', 'clients'), ...many('a', 49)], baseName: 'clients', max: 50 }), { categoryId: 'a', name: 'clients' });
  assert.deepEqual(planCategory({ channels: [cat('a', 'clients'), ...many('a', 50)], baseName: 'clients', max: 50 }), { categoryId: null, name: 'clients-2' });
  const two = [cat('a', 'clients'), ...many('a', 50), cat('b', 'clients-2'), ...many('b', 3)];
  assert.deepEqual(planCategory({ channels: two, baseName: 'clients', max: 50 }), { categoryId: 'b', name: 'clients-2' });
  const full2 = [cat('a', 'clients'), ...many('a', 50), cat('b', 'clients-2'), ...many('b', 50)];
  assert.deepEqual(planCategory({ channels: full2, baseName: 'clients', max: 50 }), { categoryId: null, name: 'clients-3' });
  assert.deepEqual(planCategory({ channels: [cat('e', 'engineers'), ...many('e', 2)], baseName: 'clients', max: 50 }), { categoryId: null, name: 'clients' });
});

function fakeDiscord() {
  const calls = { cat: [], ch: [] };
  return {
    calls,
    createCategory: async (g, { name }) => { calls.cat.push(name); return { id: `cat${calls.cat.length}` }; },
    createTextChannel: async (g, body) => { calls.ch.push(body); return { id: `ch${calls.ch.length}` }; },
  };
}

test('createClientChannel makes the category once, fills it, rolls over to the next at the cap', async () => {
  const d = fakeDiscord();
  const channels = [];
  const run = (name) => createClientChannel({ discord: d, guildId: '12345', channels, baseName: 'clients', max: 2, name, topic: 't' });
  const a = await run('1-a');
  const b = await run('2-b');
  const c = await run('3-c');
  assert.deepEqual(d.calls.cat, ['clients', 'clients-2']);
  assert.equal(a.categoryId, 'cat1');
  assert.equal(b.categoryId, 'cat1');
  assert.equal(c.categoryId, 'cat2');
  assert.equal(d.calls.ch[0].parentId, 'cat1');
  assert.equal(d.calls.ch[2].parentId, 'cat2');
});

test('createClientChannel reuses an identical channel already in our category (orphan guard)', async () => {
  const d = fakeDiscord();
  const channels = [cat('a', 'clients'), txt('x1', '5788-sohith', 'a')];
  const r = await createClientChannel({ discord: d, guildId: '12345', channels, baseName: 'clients', max: 50, name: '5788-sohith' });
  assert.deepEqual(r, { id: 'x1', categoryId: 'a', created: false });
  assert.equal(d.calls.ch.length + d.calls.cat.length, 0);
  // Same name outside our categories is not reused.
  const other = [cat('e', 'engineers'), txt('y1', '5788-sohith', 'e')];
  const r2 = await createClientChannel({ discord: d, guildId: '12345', channels: other, baseName: 'clients', max: 50, name: '5788-sohith' });
  assert.equal(r2.created, true);
});

test('privateOverwrites hides the channel from @everyone and allows only valid ids', () => {
  const ow = privateOverwrites({ guildId: '12345', viewerIds: ['900000', '900000', 'abc', ''], botUserId: '777777' });
  assert.deepEqual(ow[0], { id: '12345', type: 0, allow: '0', deny: '1024' });
  assert.deepEqual(ow.slice(1), [
    { id: '777777', type: 1, allow: '68608', deny: '0' },
    { id: '900000', type: 1, allow: '68608', deny: '0' },
  ]);
  assert.equal(privateOverwrites({ guildId: '12345' }).length, 1);
});

test('createClientChannel creates the channel private', async () => {
  const d = fakeDiscord();
  await createClientChannel({ discord: d, guildId: '12345', channels: [], baseName: 'c', max: 50, name: 'n', viewerIds: ['900000'], botUserId: '777777' });
  assert.equal(d.calls.ch[0].permissionOverwrites[0].deny, '1024');
  assert.equal(d.calls.ch[0].permissionOverwrites.length, 3);
});
