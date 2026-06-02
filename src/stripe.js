// Stripe REST adapter (Workers fetch). Reads env.STRIPE_SECRET_KEY; talks to the
// Stripe API directly (no SDK). Request SHAPES are unit-tested against a mocked
// fetch (test/stripe.test.js); live behavior is validated on the preview Worker.
// Money + PII live in Stripe — D1 only ever stores Stripe ids + status.

const API = "https://api.stripe.com/v1";

export const stripeConfigured = (env) => !!env?.STRIPE_SECRET_KEY;

// Stripe wants application/x-www-form-urlencoded with bracket notation for nested
// objects/arrays (e.g. capabilities[transfers][requested]=true).
export function formEncode(obj, prefix = "") {
  const pairs = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ik = `${key}[${i}]`;
        pairs.push(typeof item === "object" ? formEncode(item, ik) : `${encodeURIComponent(ik)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === "object") {
      pairs.push(formEncode(v, key));
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.filter(Boolean).join("&");
}

async function stripe(env, method, path, params) {
  if (!stripeConfigured(env)) throw new Error("payments are not configured");
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params ? formEncode(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

// ---- Connect (payees onboard as Express accounts) -------------------------
export const createConnectAccount = (env, { email } = {}) =>
  stripe(env, "POST", "/accounts", {
    type: "express",
    ...(email ? { email } : {}),
    capabilities: { transfers: { requested: true } },
  });

export const createAccountLink = (env, { account, refresh_url, return_url }) =>
  stripe(env, "POST", "/account_links", { account, refresh_url, return_url, type: "account_onboarding" });

export const retrieveAccount = (env, id) => stripe(env, "GET", `/accounts/${id}`);

// TEST-ONLY: a Custom connected account pre-filled with Stripe's test-verification
// magic values so the `transfers` capability activates immediately (no hosted
// onboarding). Used by the seeded test-persona payees.
export const createCustomConnectAccount = (env, persona) =>
  stripe(env, "POST", "/accounts", {
    type: "custom",
    country: "US",
    email: `${persona.handle}@example.com`,
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
    business_profile: { mcc: "5734", product_description: "Build Guild test persona" },
    individual: {
      first_name: (persona.display_name || "Test").split(" ")[0],
      last_name: "Persona",
      email: `${persona.handle}@example.com`,
      phone: "0000000000",
      ssn_last_4: "0000",
      id_number: "000000000",
      dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "address_full_match", city: "Beverly Hills", state: "CA", postal_code: "90210", country: "US" },
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
    external_account: { object: "bank_account", country: "US", currency: "usd", routing_number: "110000000", account_number: "000123456789" },
  });

// ---- escrow: authorize → capture → transfer (wired in a later increment) ---
export const createCheckoutSession = (env, p) => stripe(env, "POST", "/checkout/sessions", p);
export const retrieveSession = (env, id) => stripe(env, "GET", `/checkout/sessions/${id}`);
export const capturePaymentIntent = (env, id) => stripe(env, "POST", `/payment_intents/${id}/capture`);
export const retrievePaymentIntent = (env, id, expand = []) => {
  const qs = expand.map((e, i) => `expand[${i}]=${encodeURIComponent(e)}`).join("&");
  return stripe(env, "GET", `/payment_intents/${id}${qs ? "?" + qs : ""}`);
};
export const cancelPaymentIntent = (env, id) => stripe(env, "POST", `/payment_intents/${id}/cancel`);
export const createTransfer = (env, p) => stripe(env, "POST", "/transfers", p);
