/**
 * Look up the CRM email (the email a lead used before becoming a client) from
 * the website CRM database using the phone number and/or name provided by Stripe
 * at checkout.
 *
 * Strategy (most → least confident):
 *   1. phone + first name  → highest confidence
 *   2. phone only          → high confidence
 *   3. full name           → medium confidence
 *   4. null                → caller falls back to Stripe email
 *
 * The website DB URI is read from WEBSITE_MONGODB_URI env var.
 */
import mongoose from 'mongoose';

const PHONE_TO_COUNTRY = {
  '+44': 'UK',
  '+61': 'Australia',
  '+91': 'India',
  '+92': 'India',   // Pakistan — no matching country in COUNTRIES list, skip
  '+49': 'Europe',
  '+35': 'Europe',
  '+31': 'Europe',
  '+33': 'Europe',
  '+48': 'Europe',
  '+38': 'Europe',
  '+40': 'Europe',
  '+32': 'Europe',
  '+34': 'Europe',
  '+39': 'Europe',
  '+36': 'Europe',
  '+30': 'Europe',
};

/** Normalise a phone string: strip spaces, dashes, brackets */
function normalisePhone(phone) {
  return String(phone || '').replace(/[\s\-().]/g, '');
}

/**
 * Derive country from phone prefix.
 * +1 numbers are US or Canada — use currency to disambiguate.
 * @param {string} phone  normalised phone e.g. "+447984014950"
 * @param {string} currency  e.g. "GBP", "USD", "CAD", "AUD", "EUR"
 * @returns {string|undefined}
 */
export function countryFromPhone(phone, currency = '') {
  const p = normalisePhone(phone);
  const cur = String(currency).toUpperCase();

  if (p.startsWith('+1')) return cur === 'CAD' ? 'Canada' : 'USA';
  if (p.startsWith('+44')) return 'UK';
  if (p.startsWith('+61')) return 'Australia';
  if (p.startsWith('+91')) return 'India';

  for (const [prefix, country] of Object.entries(PHONE_TO_COUNTRY)) {
    if (p.startsWith(prefix)) return country;
  }
  return undefined;
}

let _crmDb = null;

async function getCrmDb() {
  const uri = process.env.WEBSITE_MONGODB_URI;
  if (!uri) return null;
  if (_crmDb) return _crmDb;
  try {
    const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
    _crmDb = conn.db;
    return _crmDb;
  } catch (e) {
    console.warn('[crmLookup] could not connect to website DB:', e?.message?.slice(0, 100));
    return null;
  }
}

/**
 * Look up CRM email using phone + name from Stripe.
 * @param {{phone?: string, name?: string}} p
 * @returns {Promise<string|null>} CRM email or null if not found
 */
export async function lookupCrmEmail({ phone, name }) {
  const db = await getCrmDb();
  if (!db) return null;

  const col = db.collection('campaignbookings');
  const p = normalisePhone(phone);
  const firstName = String(name || '').trim().split(/\s+/)[0];

  // 1. Phone + first name (most confident)
  if (p && firstName) {
    const phoneRe = p.replace(/[+]/g, '\\$&');
    const doc = await col.findOne(
      {
        clientPhone: { $regex: phoneRe, $options: 'i' },
        clientName:  { $regex: firstName, $options: 'i' },
      },
      { sort: { _id: -1 }, projection: { clientEmail: 1 } }
    );
    if (doc?.clientEmail) return doc.clientEmail.toLowerCase().trim();
  }

  // 2. Phone only
  if (p) {
    const phoneRe = p.replace(/[+]/g, '\\$&');
    let doc = await col.findOne(
      { clientPhone: { $regex: phoneRe, $options: 'i' } },
      { sort: { _id: -1 }, projection: { clientEmail: 1 } }
    );
    // Try last 10 digits (handles local format without country code)
    if (!doc && p.length >= 10) {
      const last10 = p.slice(-10);
      doc = await col.findOne(
        { clientPhone: { $regex: last10 } },
        { sort: { _id: -1 }, projection: { clientEmail: 1 } }
      );
    }
    if (doc?.clientEmail) return doc.clientEmail.toLowerCase().trim();
  }

  // 3. Full name match
  if (name) {
    const parts = String(name).trim().split(/\s+/);
    const first = parts[0];
    const last  = parts[parts.length - 1];
    if (first && last && first !== last) {
      const doc = await col.findOne(
        { clientName: { $regex: `(?=.*${first})(?=.*${last})`, $options: 'i' } },
        { sort: { _id: -1 }, projection: { clientEmail: 1 } }
      );
      if (doc?.clientEmail) return doc.clientEmail.toLowerCase().trim();
    }
  }

  return null;
}
