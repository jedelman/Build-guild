# How Build Guild's records work — and how to roll your own

Build Guild is a pile of **signed records**. No authoritative API: anyone can read
them, verify them, and compute their own view. This page is the whole protocol. If
you can write a `for` loop and call an HTTP endpoint, you can participate.

## 1. One envelope, one signing rule

Every record is JSON with a `sig`. To **sign**, you sign the *canonical bytes of the
record without its `sig`*:

```
canonical(rec) = JSON with keys sorted, no spaces        # the ONLY tricky part
sig            = ECDSA_P256_SHA256( canonical(rec) )      # raw 64-byte r‖s
```

Two interop details — get these right and everything else is plain JSON:

- **Canonical JSON** is one stdlib call:
  - Python: `json.dumps(rec_without_sig, sort_keys=True, separators=(",",":"), ensure_ascii=False)`
  - JS: sorted-key `JSON.stringify` (see `src/governance.js#canonicalize`)
  - House rules so they always match: **ASCII text, and no floats** (use ints —
    amounts in cents, timestamps as ISO strings).
- **Signatures are raw 64-byte `r‖s`** (WebCrypto / atproto style), *not* DER.
  Python's `cryptography` gives DER, so convert (≈5 lines, below). Use low-S to
  match atproto exactly.

To **verify**: resolve the author's public key, recompute `canonical`, check the sig.
The content id of a record is `recordRef = sha256(canonical(signed record))` — that's
how one record pins another (a vote pins its proposal, like an atproto strongRef).

## 2. There are only two kinds of record: *things*, and *opinions about things*

**Anchors — a thing, with payload.** Someone declares it; others point at it.

| anchor | who signs | carries |
|---|---|---|
| `charter` | a guild's founder | the rules: roles, vote thresholds, quorum |
| `quest` / settlement | the patron | "work commissioned/paid": guild + party + amount |
| `proposal` | a guild member | the question to be voted on |

**Attestations — a signed `yes` / `no` / `unknown` about a subject.** This is *most* of
the system. Shape: `{ by, subject, predicate, value, context, at, sig }`.

| you want to… | attestation |
|---|---|
| endorse a skill | subject = a person, predicate = `skill:rust`, value = yes |
| rate a delivery | subject = a guild, predicate = `deliver.on-time`, context = a settlement |
| vote | subject = a proposal, predicate = `vote`, value = yes/no |
| admit / remove a member | subject = a person, predicate = `member`, value = yes/no |

(That's the consolidation: governance acts and reputation are the *same* primitive —
an eligibility-gated, co-signed, ternary opinion. "Things, and opinions about things.")

## 3. Predicates = the ontology = what we value (contribution)

`deliver.on-time` · `deliver.quality` · `splits.fair` · `pays.promptly` ·
`specs.clearly` · `skill:<name>` · `member` · `vote`. Each has a one-line human
sentence and an **eligibility rule**. Anyone can propose a new predicate; a small
curated core keeps counts comparable. (Choosing what's recordable is a value
statement — ours is contribution.)

## 4. Who's allowed to say what (eligibility)

A count only means something if the signer had standing. Every rule reduces to *"are
you named in the relevant anchor?"*:

- `patron_of_quest` — you're the patron on the cited settlement
- `party_of_quest` — you're in its party
- `member_of_guild` — you're a member per the charter
- `anyone` — open (e.g. skill endorsements)

Ineligible attestations are simply not counted. Sybils can sign all day; without
standing in an anchor, they're noise.

## 5. Reading it — bring your own algorithm

We publish facts; **you** compute meaning. There is no canonical score.

- **Reputation** = for a subject, count the *eligible* attestations per predicate →
  `{yes, no, unknown}` (a "badge cloud"). Want recency-decay or trust-graph weighting?
  Run your own function over the same facts; every record is timestamped.
- **Governance** = replay a guild's membership / role / vote attestations against its
  charter's rules → who's a member, what passed.

Reference implementations live in `src/governance.js` (`observe`, `tallyBadges`,
`deriveGuildState`) — but they're *one* reading, not the truth.

## 6. Participate in ~20 lines of Python

```python
import json, base64, requests
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes

def canonical(rec):
    body = {k: v for k, v in rec.items() if k != "sig"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

def der_to_raw(der):                      # DER -> 64-byte r‖s (the one gotcha)
    r, s = utils.decode_dss_signature(der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")

def sign(rec, priv):
    der = priv.sign(canonical(rec), ec.ECDSA(hashes.SHA256()))
    rec["sig"] = base64.b64encode(der_to_raw(der)).decode()
    return rec

# endorse someone's Rust:
att = sign({ "type": "org.buildguild.attestation", "attester": MY_DID,
             "subject": THEIR_DID, "contract": "skill:rust", "value": "yes",
             "context": None, "createdAt": "2026-06-02T00:00:00Z" }, my_key)
requests.post(API + "/gov/attestations", json={"record": att})

# read + tally a subject's "skill:rust" (verify omitted for brevity):
recs = requests.get(API + f"/gov/reputation?subject={THEIR_DID}&type=builder").json()
print(recs["badges"].get("skill:rust"))   # {'yes': 12, 'no': 1, ...}
```

## The whole thing, summarized

**1 signing rule · 2 record shapes (anchors + attestations) · ~8 predicates · 4
eligibility rules · 2 read functions.** Everything else is JSON. The only real craft
is the two crypto-interop details in §1 — get those and you've got a full client.
