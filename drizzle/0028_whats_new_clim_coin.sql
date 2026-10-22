-- "What's new" entries for Clim Coin, the shop and skill trees. Editorial
-- copy (edit it in /admin/site); re-runnable, and existing ids are left alone.
INSERT INTO "changelog_entries" ("id", "date", "title", "description", "category")
VALUES
  ('clim-coin', '2026-10-21', 'Clim Coin', 'Meet Clim Coin, the season''s currency. You earn it automatically: 10 for winning a week (7 for 2nd, 5 for 3rd, 2 for everyone else scored), plus coins for entering, calling the winner and voting. Check your balance and history in the wallet on your profile, and gift coins to other players, up to 5 a week.', 'new'),
  ('clim-coin-shop', '2026-10-21', 'The Clim Coin shop', 'Spend your coins in the new shop: pets (yours follows you round the site), avatars, titles, name colours and profile themes, plus once-a-season power-ups like Golden Week, Double Down, Sabotage and Shield. Everyone sees what you wear, and some stock is only around for a limited time.', 'new'),
  ('skill-trees', '2026-10-22', 'Skill trees', 'Pick a pathway for the season (Stormbrewer, Elite Hacker, Friendkeeper, Overachiever or Elephant Cartographer) and unlock its skills with Clim Coin. Each skill pays you back with bonus coins or shop discounts, and the tree ends in an exclusive title and name colour. Skills never change leaderboard points, and your pick lasts the whole season.', 'new')
ON CONFLICT ("id") DO NOTHING;