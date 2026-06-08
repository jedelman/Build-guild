-- Persist the patron-signed settlement's content id (its recordRef) on the escrow
-- row, so party members can attest split-fairness against it (the splits.fair
-- predicate is party_of_quest-eligible and needs the settlement as its context).
-- Non-destructive.
ALTER TABLE escrow_holds ADD COLUMN settlement_ref TEXT NOT NULL DEFAULT '';
