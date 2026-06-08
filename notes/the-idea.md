# How a guild runs itself — with no boss, no server, and no clock you have to trust

*An intro for the curious. No code, no jargon you haven't been handed. If you've ever
been in a group chat, a co-op, a band, or a raid party, you already have the instincts
this is built on.*

---

## The itch

You want to team up. Pool your skills, cover each other's gaps, share the work and the
money. The moment you do, a quiet question shows up: **who's in charge of the shared
stuff?**

Normally there are two answers, and both cost something:

- **A boss.** Someone owns the group — the founder, the admin, the one with the password.
  Clean and fast, until they leave, flake, or turn. Then the group *is* the problem.
- **A company's server.** You all sign up to some platform, and *it* keeps the roster,
  the votes, the receipts. Convenient, until it changes the rules, sells, or shuts down —
  and walks off with your history.

Build Guild is a bet on a third answer: **the group governs itself, out in the open, and
nobody owns it.** No founder with a master key. No server that's the source of truth. And
— the part people find strangest at first — **no clock anybody has to trust.**

This page is the pitch and the principles. The claim is simple to say and was the whole
work to make true: *a group of people can keep an honest, shared, tamper-proof record of
who they are and what they've agreed — and anyone, including a total stranger, can check
it for themselves.*

---

## Principle 1 — Signed letters, not accounts

Forget logins and databases for a second. Picture a **wax-sealed letter**.

Everything in a guild is a little letter like that: *"I propose we admit Mara."* *"I vote
yes."* *"I grant Wren the role of delivery-witness."* Each one is **signed** by its author
with a personal seal that's impossible to fake and trivial to check. The seal is math
(cryptography), but the idea is medieval: you can recognize my seal, and you can tell if
the letter was tampered with after I sealed it.

There's no inbox owned by a company. The letters just *exist*, and they carry their own
proof. To know what's true, you don't ask an authority — **you read the letters and check
the seals yourself.** Anyone can. That's the whole shift: truth you can verify instead of
truth you're told.

> Your identity, by the way, is just your seal — in practice, your Bluesky handle. It's
> *yours*. You can take it, and your whole history, anywhere. Nobody can lock you in or
> lock you out.

---

## Principle 2 — Fingerprints, not filenames

Here's the trick that makes the letters tamper-proof as a *set*, not just one at a time.

Every letter gets an **id that is computed from its exact contents** — like a fingerprint.
Change one character and the fingerprint changes completely. So you can't quietly edit a
letter after the fact: its fingerprint wouldn't match, and everyone would see the seam.

Now the magic: a new letter can **point at an old one by its fingerprint.** *"I'm
recalling the mandate granted in letter `a3f9…`."* Because the fingerprint is baked into
the contents, that pointer can never be redirected to a different letter. It's a permanent,
checkable link.

String those links together and you get a **chain you can walk** — backward to see how any
decision was reached, or forward to see what came of it. An "audit" isn't a special
privilege you request from an admin. It's just *following the fingerprints.* If something
dangles or doesn't add up, it's visible to anyone looking.

---

## Principle 3 — No masters: authority is borrowed, never owned

Most groups quietly grow a ruling class — the founder stays special forever, admins
accumulate. Build Guild's rule is deliberately the opposite, and it's baked into the math:

**Founding is just signing the first letter — the charter — that lists the starting
members. After that, the founders are ordinary members. Founding buys you nothing.**

So where does any authority come from? **Only from a vote.** Want someone admitted? Vote.
Want to remove someone? Vote. The thresholds (how many yes-votes, how much turnout) are
written in the charter, per kind of decision, for everyone to see in advance.

And "officers"? There are none, in the sense of standing power. Instead there are
**mandates**: a member is handed a *specific, bounded errand* by vote — "Wren may witness
deliveries," "Mara may admit new members" — and the group can **take it back at any time**,
usually at a much lower bar than it took to grant. A mandate is a borrowed tool, not a
throne. It's scoped (it only covers the one thing), it's recallable (cheaply), and it
never makes the holder special at anything else.

This is the anarcho-syndicalist bit, if you want the label: power is decomposed into small,
revocable errands handed up from the membership — never a seat someone sits in.

---

## Principle 4 — Your vote is about *this* room

Here's a subtle one that trips up even careful systems.

You vote on a proposal. But while the vote is open, the **roster changes** — someone new is
admitted, someone is removed. The people in the room are now different. Is your old vote
still valid? You cast it about a *different group* than the one that exists now.

Build Guild's answer is **live roster**: your vote is pinned to the exact membership you
saw when you cast it. If the room changes underneath an unresolved vote, that vote is
**plainly stale — and you simply vote again** against the new room. Nobody has to detect
this with a stopwatch or a judgment call; the staleness is *visible by inspection*, because
your vote literally carries a fingerprint of the roster it was about.

Why pay this cost (occasionally re-voting)? Because the alternative is deciding the fate of
a group using the opinions of people who've left, or without the voice of people who've
just joined. Live roster says: **a decision should reflect the room it actually lands in.**

---

## Principle 5 — Order without a clock

This is the strangest principle and, honestly, the favorite.

When two things happen in a group, which came first? The obvious answer is "check the
timestamps." But a timestamp is just a *claim* someone's device wrote down. Clocks drift,
clocks lie, and clocks can be set on purpose. If your whole notion of "who has authority"
hinges on trusting everyone's timestamps, you've quietly reintroduced a thing to attack —
and you get **races**: two actions stamped the same instant, and no honest way to say which
wins.

So Build Guild throws the clock out of the trust path entirely. Instead of *"when did this
happen,"* it asks *"what did you build this on?"*

Think of a **group chat with replies.** You don't need synchronized clocks to understand a
threaded conversation — each reply points at the message it's answering. The *structure*
tells you the order. Two messages that reply to the same parent, with neither aware of the
other, are simply **concurrent** — and that's the honest truth, not a tie to be broken by a
millisecond.

Every guild act works the same way. A vote says *"I'm built on this roster."* A recall says
*"I'm cancelling that specific grant."* A re-grant says *"I'm replacing that recall."* Those
pointers — fingerprints again — define a **causal order** everyone computes the same way,
from the letters alone, with no clock involved. When two acts genuinely didn't know about
each other, the system *says so* rather than pretending one was first. (For the rare case
where two truly-concurrent acts must be tie-broken, it uses the one thing that's already
fixed and forgery-proof: their fingerprints. Never a timestamp.)

The payoff: **two strangers, handed the same pile of letters in any order, compute the
exact same history — down to the byte.** That's what makes this a shared truth instead of
one server's opinion.

---

## The whole thing, in one little story

Five letters, and watch how no clock and no boss appear anywhere:

1. **The charter.** Ada and Ben sign the founding letter: *"This guild starts with Ada and
   Ben. Admitting needs half of us; recalling a mandate needs only a third."* They are now
   ordinary members.
2. **Admit Mara.** Someone proposes it. Ada and Ben vote yes — each vote pinned to *"the
   roster as of the charter."* It passes. Mara's in. The roster has a new head.
3. **Trust Wren to witness.** A proposal to give Wren a narrow *delivery-witness* mandate.
   The votes are pinned to *"the roster that now includes Mara."* It passes. Wren can
   witness deliveries — and nothing else.
4. **Mandate Mara to admit — then take it back.** They grant Mara an *admit* mandate, then
   recall it. The recall **points at the grant** by fingerprint, so everyone orders them
   *grant-then-recall* without anyone's clock. Mara's errand is over.
5. **Anyone audits.** A newcomer shows up, reads the five letters, checks the seals, walks
   the fingerprints, and arrives at exactly the state everyone else sees: *members Ada,
   Ben, Mara; Wren holds one witness mandate; nobody holds anything else.* No login, no
   admin, no trust required.

Nowhere in that story did we ask "who's in charge?" or "whose timestamp wins?" The letters
answered everything.

---

## Why bother

- **Nobody can capture it.** There's no master key to steal, no founder to corrupt, no
  server to seize. Authority is always borrowed and always recallable.
- **You can leave with everything.** Your identity and your history are yours, portable by
  design. The guild can't hold them hostage.
- **It's checkable by anyone.** Trust is replaced by verification. You never have to take
  the group's — or a company's — word for what happened.
- **It survives disagreement.** Because everyone computes the same history from the same
  letters, the system doesn't fall apart when people are offline, out of sync, or don't
  trust each other. It only needs the letters.

---

## The honest part

No pitch is complete without its sharp edges, and trust is built by naming them:

- **Live roster has a cost — now with a guard.** If the roster churns constantly, votes
  keep going stale and have to be recast — and a bad actor could *abuse* that to stall a
  decision (keep admitting people to reset everyone's vote). The guard is **freeze-at-open**:
  the charter can mark a kind of decision so that, once a vote opens, its electorate is
  locked to the people present at that moment — later churn can't reset it. It's opt-in, per
  kind of decision, because it trades "maximally current" for "can't be stalled" — and you
  want that trade only where stalling is a real risk.
- **"No boss" is not "no work."** Self-governance means the group actually has to vote,
  show up, and tend its own rules. The tools make it cheap and honest; they don't make it
  effortless.
- **This is frontier.** Portable identity exists and works; founder-free, clock-free
  self-governance on top of it is genuinely new ground. We're building it in the open, with
  the limits written down, on purpose.

---

## Want the engine room?

This page is the *why*. If you can write a `for` loop and call a web address, the *how* —
the exact letter format, the one signing rule, and how to compute the whole guild state
yourself in any language — is in **[`how-it-works.md`](./how-it-works.md)**. The deeper
design reasoning lives in **[`designation-primitive.md`](./designation-primitive.md) §8**.

Don't job-hunt alone. Don't get governed by a stranger's server, either.
