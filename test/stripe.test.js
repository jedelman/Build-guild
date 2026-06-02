// Verifies the Stripe adapter builds correct REST requests (the part testable
// without hitting Stripe). Live behavior is validated on the preview Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formEncode,
  stripeConfigured,
  createConnectAccount,
  createAccountLink,
  createCheckoutSession,
  capturePaymentIntent,
  createTransfer,
  createCustomConnectAccount,
} from "../src/stripe.js";

const env = { STRIPE_SECRET_KEY: "sk_test_123" };
let calls;
function mockFetch(responseBody = { id: "obj_1" }) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => responseBody };
  };
}

test("formEncode nests objects + arrays with bracket notation", () => {
  assert.equal(formEncode({ a: 1, b: { c: 2 } }), "a=1&b%5Bc%5D=2");
  assert.equal(
    formEncode({ capabilities: { transfers: { requested: true } } }),
    "capabilities%5Btransfers%5D%5Brequested%5D=true"
  );
});

test("stripeConfigured reflects the secret", () => {
  assert.equal(stripeConfigured(env), true);
  assert.equal(stripeConfigured({}), false);
});

test("createConnectAccount POSTs an Express account requesting transfers", async () => {
  mockFetch({ id: "acct_1" });
  const out = await createConnectAccount(env, { email: "a@b.com" });
  assert.equal(out.id, "acct_1");
  const c = calls[0];
  assert.equal(c.url, "https://api.stripe.com/v1/accounts");
  assert.equal(c.opts.method, "POST");
  assert.equal(c.opts.headers.Authorization, "Bearer sk_test_123");
  assert.match(c.opts.body, /type=express/);
  assert.match(c.opts.body, /email=a%40b\.com/);
  assert.match(c.opts.body, /capabilities%5Btransfers%5D%5Brequested%5D=true/);
});

test("createAccountLink POSTs an onboarding link with return/refresh urls", async () => {
  mockFetch({ url: "https://connect.stripe.com/setup/x" });
  await createAccountLink(env, { account: "acct_1", refresh_url: "https://app/r", return_url: "https://app/d" });
  const c = calls[0];
  assert.equal(c.url, "https://api.stripe.com/v1/account_links");
  assert.match(c.opts.body, /account=acct_1/);
  assert.match(c.opts.body, /type=account_onboarding/);
  assert.match(c.opts.body, /return_url=https%3A%2F%2Fapp%2Fd/);
});

test("createCheckoutSession carries manual capture for escrow", async () => {
  mockFetch({ id: "cs_1", url: "https://checkout.stripe.com/x" });
  await createCheckoutSession(env, {
    mode: "payment",
    success_url: "https://app/ok",
    cancel_url: "https://app/no",
    payment_intent_data: { capture_method: "manual" },
  });
  const c = calls[0];
  assert.equal(c.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.match(c.opts.body, /payment_intent_data%5Bcapture_method%5D=manual/);
});

test("ACH checkout session selects us_bank_account and does NOT manual-capture", async () => {
  mockFetch({ id: "cs_2", url: "https://checkout.stripe.com/y" });
  await createCheckoutSession(env, {
    mode: "payment",
    payment_method_types: ["us_bank_account"],
    success_url: "https://app/ok",
    cancel_url: "https://app/no",
  });
  const c = calls[0];
  assert.match(c.opts.body, /payment_method_types%5B0%5D=us_bank_account/);
  assert.doesNotMatch(c.opts.body, /capture_method/); // ACH can't authorize-and-hold
});

test("createCustomConnectAccount requests transfers with test-verification values", async () => {
  mockFetch({ id: "acct_custom" });
  await createCustomConnectAccount(env, { handle: "ada.test", display_name: "Ada (test)" });
  const c = calls[0];
  assert.equal(c.url, "https://api.stripe.com/v1/accounts");
  assert.match(c.opts.body, /type=custom/);
  assert.match(c.opts.body, /capabilities%5Btransfers%5D%5Brequested%5D=true/);
  assert.match(c.opts.body, /individual%5Bid_number%5D=000000000/);
  assert.match(c.opts.body, /external_account%5Brouting_number%5D=110000000/);
});

test("capture + transfer hit the right endpoints", async () => {
  mockFetch({ id: "pi_1" });
  await capturePaymentIntent(env, "pi_1");
  assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_intents/pi_1/capture");
  assert.equal(calls[0].opts.method, "POST");

  mockFetch({ id: "tr_1" });
  await createTransfer(env, { amount: 49500, currency: "usd", destination: "acct_2", transfer_group: "quest_7" });
  assert.equal(calls[0].url, "https://api.stripe.com/v1/transfers");
  assert.match(calls[0].opts.body, /destination=acct_2/);
  assert.match(calls[0].opts.body, /amount=49500/);
});
