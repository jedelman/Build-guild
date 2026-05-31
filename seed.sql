-- Sample roster so the guild mechanics are visible on first run.
DELETE FROM guild_members;
DELETE FROM projects;
DELETE FROM skills;
DELETE FROM guilds;
DELETE FROM builders;
DELETE FROM sqlite_sequence WHERE name IN ('builders','skills','projects','guilds');

INSERT INTO builders (id, handle, display_name, klass, tagline, bio, seeking, ai_augmented) VALUES
 (1,'codewright.bsky.social','Codewright','Architect','Systems thinker who hates the job-hunt grind','Designs the load-bearing walls. Believes the best results come from human skill + AI augmentation.','collaborators + income',1),
 (2,'pixelmancer.bsky.social','Pixelmancer','Artificer','Turns rough ideas into things people want to touch','Product designer & front-end crafter. Lives in Figma and CSS.','collaborators',1),
 (3,'datadruid.bsky.social','Data Druid','Druid','Whisperer of messy datasets','ML + data engineering. Makes models behave and pipelines flow.','income',1),
 (4,'shellsmith.bsky.social','Shellsmith','Ranger','Ships it and keeps it up','Infra, DevOps and security. The one who is paged at 3am so you are not.','both',1),
 (5,'wordweaver.bsky.social','Wordweaver','Bard','Makes people actually understand what you built','Copy, narrative and community. Turns features into stories.','collaborators',0);

INSERT INTO skills (builder_id, name, peak) VALUES
 -- Codewright: backend / architecture peaks
 (1,'System Design',92),(1,'Distributed Systems',85),(1,'Rust',80),(1,'Technical Writing',70),
 -- Pixelmancer: design / front-end peaks
 (2,'Product Design',95),(2,'Frontend',88),(2,'Animation',82),(2,'Branding',75),
 -- Data Druid: ML / data peaks
 (3,'Machine Learning',90),(3,'Python',85),(3,'Data Engineering',80),(3,'Statistics',78),
 -- Shellsmith: infra / security peaks (the guild's current gap)
 (4,'Bash',90),(4,'DevOps',88),(4,'Kubernetes',84),(4,'Security',76),
 -- Wordweaver: comms / growth peaks (also a gap)
 (5,'Copywriting',92),(5,'Community',85),(5,'Marketing',80),(5,'Video',70);

INSERT INTO projects (builder_id, name, description, help_wanted, url) VALUES
 (1,'Skillforge','A self-hostable knowledge base that maps a team''s collective skill-peaks.','Needs a real UI and a growth story.','https://example.com/skillforge'),
 (2,'Motionkit','Drop-in animation primitives for indie web apps.','Looking for someone to harden the build pipeline.',''),
 (3,'Tidepool','Tiny feature store for solo ML builders.','Wants help explaining it to non-ML folks.','');

INSERT INTO guilds (id, name, charter) VALUES
 (1,'The Indie Vanguard','A small, diverse party of builders trading skill-peaks while we each look for our next thing. 100% like an MMORPG guild.');

-- Founding party: strong on backend, design and ML; visibly missing infra and comms.
INSERT INTO guild_members (guild_id, builder_id, role) VALUES
 (1,1,'founder'),
 (1,2,'officer'),
 (1,3,'member');

-- Link the seeded skills to the canonical catalog, mirroring what
-- migrations/0005_skill_catalog.sql does to existing data in prod. `db:reset`
-- migrates an empty DB (so the migration's backfill is a no-op) and only then
-- seeds, so the linkage has to happen here too. Idempotent across re-seeds.
INSERT OR IGNORE INTO skill_catalog (slug, name)
  SELECT lower(trim(name)), MIN(trim(name)) FROM skills GROUP BY lower(trim(name));
UPDATE skills
   SET skill_id = (SELECT id FROM skill_catalog c WHERE c.slug = lower(trim(skills.name)))
 WHERE skill_id IS NULL;
