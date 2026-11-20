/**
 * Best-effort match of a CSM name to a Discord guild member. Pure.
 * Never guesses between two people: a tie returns confidence 'none'.
 */

/** @param {unknown} s */
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memberNames(m) {
  return [m?.nick, m?.user?.global_name, m?.user?.username].map(normalize).filter(Boolean);
}

/**
 * @param {string} csmName
 * @param {Array<{user?: {id: string, username?: string, global_name?: string}, nick?: string}>} members
 * @returns {{userId: string|null, confidence: 'exact'|'strong'|'none', candidates: string[]}}
 */
export function matchCsmToMember(csmName, members) {
  const full = normalize(csmName);
  const none = (candidates = []) => ({ userId: null, confidence: 'none', candidates });
  if (!full || !Array.isArray(members)) return none();

  const exact = members.filter((m) => m?.user?.id && memberNames(m).includes(full));
  if (exact.length === 1) return { userId: exact[0].user.id, confidence: 'exact', candidates: [exact[0].user.id] };
  if (exact.length > 1) return none(exact.map((m) => m.user.id));

  const tokens = full.split(' ');
  const strong = members.filter((m) => {
    if (!m?.user?.id) return false;
    return memberNames(m).some((n) => {
      const have = n.split(' ');
      return tokens.every((t) => have.includes(t));
    });
  });
  if (strong.length === 1) return { userId: strong[0].user.id, confidence: 'strong', candidates: [strong[0].user.id] };
  return none(strong.map((m) => m.user.id));
}

/**
 * An explicit discordUserId on the portal user always wins. Otherwise fall back
 * to the name match and accept only 'exact' or 'strong'.
 * @param {{portalUser?: {name?: string, discordUserId?: string}|null, members?: object[], fallbackName?: string}} p
 * @returns {{userId: string|null, confidence: string, candidates: string[]}}
 */
export function resolveCsmDiscordId({ portalUser, members, fallbackName }) {
  const explicit = String(portalUser?.discordUserId || '').trim();
  if (explicit) return { userId: explicit, confidence: 'exact', candidates: [explicit] };
  const name = portalUser?.name || fallbackName || '';
  const m = matchCsmToMember(name, members || []);
  if (m.confidence === 'exact' || m.confidence === 'strong') return m;
  return { userId: null, confidence: 'none', candidates: m.candidates };
}
