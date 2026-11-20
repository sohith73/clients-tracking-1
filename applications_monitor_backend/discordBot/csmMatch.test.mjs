import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCsmToMember, resolveCsmDiscordId } from './csmMatch.js';

const m = (id, username, global_name, nick) => ({ user: { id, username, global_name }, nick });

test('exact match on nick, global_name or username', () => {
  const members = [m('1', 'sam_l', 'Sam Lee', null), m('2', 'other', 'Other Person', null)];
  assert.deepEqual(matchCsmToMember('sam lee', members), { userId: '1', confidence: 'exact', candidates: ['1'] });
  assert.equal(matchCsmToMember('Other Person', members).userId, '2');
  assert.equal(matchCsmToMember('Dave', [m('3', 'x', 'y', 'Dave')]).confidence, 'exact');
});

test('strong match when all tokens appear and one member qualifies', () => {
  const members = [m('1', 'sam', 'Sam Lee (CSM)', null), m('2', 'zed', 'Zed', null)];
  const r = matchCsmToMember('Sam Lee', members);
  assert.equal(r.confidence, 'strong');
  assert.equal(r.userId, '1');
});

test('ambiguous tie returns none with candidates', () => {
  const members = [m('1', 'a', 'Sam Lee Sales', null), m('2', 'b', 'Sam Lee Support', null)];
  const r = matchCsmToMember('Sam Lee', members);
  assert.equal(r.confidence, 'none');
  assert.equal(r.userId, null);
  assert.deepEqual(r.candidates.sort(), ['1', '2']);
});

test('accents and punctuation are normalized', () => {
  const members = [m('1', 'jose', 'José  Núñez.', null)];
  assert.equal(matchCsmToMember('jose nunez', members).confidence, 'exact');
});

test('no match, empty name, bad members', () => {
  assert.equal(matchCsmToMember('Nobody Here', [m('1', 'a', 'Sam', null)]).confidence, 'none');
  assert.equal(matchCsmToMember('', [m('1', 'a', 'Sam', null)]).confidence, 'none');
  assert.equal(matchCsmToMember('Sam', null).confidence, 'none');
});

test('resolveCsmDiscordId: explicit id wins, else only exact or strong', () => {
  const members = [m('1', 'a', 'Sam Lee', null)];
  assert.equal(resolveCsmDiscordId({ portalUser: { name: 'Sam Lee', discordUserId: '777' }, members }).userId, '777');
  assert.equal(resolveCsmDiscordId({ portalUser: { name: 'Sam Lee' }, members }).userId, '1');
  const tie = [m('1', 'a', 'Sam Lee A', null), m('2', 'b', 'Sam Lee B', null)];
  const r = resolveCsmDiscordId({ portalUser: { name: 'Sam Lee' }, members: tie });
  assert.equal(r.userId, null);
  assert.equal(resolveCsmDiscordId({ portalUser: null, members, fallbackName: 'Sam Lee' }).userId, '1');
});
