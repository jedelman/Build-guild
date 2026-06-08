#!/usr/bin/env node
// Build Guild — minimal pure-CLI reference client. Fork this.
//
// Reuses the canonical verifier (src/governance.js) + ontology (src/contracts.js)
// verbatim — the same code the web app and Worker use. Proves you can fully
// participate without our UI: keygen, sign attestations, and tally a subject's
// reputation from a file of records. Records are signed JSON; nothing here needs a
// PDS or our API (post the JSON wherever you like).
//
//   node cli/buildguild.mjs keygen <did> > alice.key.json
//   node cli/buildguild.mjs attest alice.key.json <subject> <predicate> <yes|no|unknown> [contextRef] >> records.json
//   node cli/buildguild.mjs tally <subject> <builder|guild|client> records.json keyring.json
//
// keyring.json maps did -> public JWK ({ "<did>": {...jwk...} }). `keygen` prints a
// key file containing both the private + public JWK and the DID.
import { readFileSync } from "node:fs";
import { signRecord, verifyRecords, tallyBadges, observe } from "../src/governance.js";
import { contractsFor } from "../src/contracts.js";

const [cmd, ...args] = process.argv.slice(2);
const die = (m) => {
  console.error("error: " + m);
  process.exit(1);
};
const subtle = globalThis.crypto.subtle;

async function importPriv(jwk) {
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
async function importPub(jwk) {
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
}

async function keygen() {
  const did = args[0] || `did:cli:${Math.random().toString(36).slice(2, 10)}`;
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await subtle.exportKey("jwk", pair.privateKey);
  const pub = await subtle.exportKey("jwk", pair.publicKey);
  delete pub.key_ops;
  delete pub.ext;
  console.log(JSON.stringify({ did, priv, pub }, null, 2));
}

async function attest() {
  const [keyfile, subject, predicate, value, contextRef] = args;
  if (!keyfile || !subject || !predicate || !value) die("usage: attest <keyfile> <subject> <predicate> <yes|no|unknown> [contextRef]");
  if (!["yes", "no", "unknown"].includes(value)) die("value must be yes | no | unknown");
  const key = JSON.parse(readFileSync(keyfile, "utf8"));
  const priv = await importPriv(key.priv);
  const record = await signRecord(
    {
      type: "org.buildguild.attestation",
      attester: key.did,
      subject,
      predicate,
      value,
      context: contextRef ? { uri: contextRef, cid: contextRef } : null,
      createdAt: new Date().toISOString(),
    },
    priv
  );
  console.log(JSON.stringify(record));
}

async function tally() {
  const [subject, subjectType, recordsFile, keyringFile] = args;
  if (!subject || !subjectType || !recordsFile || !keyringFile) die("usage: tally <subject> <builder|guild|client> <records.json> <keyring.json>");
  // records.json may be a JSON array, or newline-delimited JSON objects.
  const raw = readFileSync(recordsFile, "utf8").trim();
  const records = raw.startsWith("[") ? JSON.parse(raw) : raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const keyring = JSON.parse(readFileSync(keyringFile, "utf8"));
  const imported = new Map();
  for (const [did, jwk] of Object.entries(keyring)) imported.set(did, await importPub(jwk));
  const resolve = async (did) => imported.get(did) || null;

  const verified = await verifyRecords(records, resolve);
  const contracts = contractsFor(verified.map((r) => r.predicate || r.contract).filter(Boolean));
  // normalize: this CLI uses `predicate`; tallyBadges reads `contract` — alias it.
  for (const r of verified) if (r.predicate && !r.contract) r.contract = r.predicate;
  const cloud = tallyBadges(subject, verified, contracts, {}, { subjectType });
  const facts = observe(subject, verified, contracts, {}, { subjectType });
  console.log(JSON.stringify({ ...cloud, factCount: facts.length }, null, 2));
}

const run = { keygen, attest, tally }[cmd];
if (!run) die("commands: keygen | attest | tally");
run().catch((e) => die(e.message));
