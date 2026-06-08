-- Peer-to-peer payments: quests declare WHEN payment is due (negotiated per quest)
-- since there's no escrow. 'on_delivery' (patron pays after accepting) or 'upfront'
-- (patron pays at claim). Non-destructive.
ALTER TABLE quests ADD COLUMN terms TEXT NOT NULL DEFAULT 'on_delivery';
