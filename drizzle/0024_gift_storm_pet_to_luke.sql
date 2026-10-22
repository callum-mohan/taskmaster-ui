-- Gift Luke the "A Storm Is Brewing" pet for free: a zero-price purchase, the
-- same way crate wins are owned. Re-runnable and a no-op when Luke or the
-- item doesn't exist, or he already owns it.
INSERT INTO "coin_purchases" ("player_id", "item_id", "price")
SELECT 'luke', 'a-storm-is-brewing', 0
WHERE EXISTS (SELECT 1 FROM "players" WHERE "id" = 'luke')
  AND EXISTS (SELECT 1 FROM "shop_items" WHERE "id" = 'a-storm-is-brewing')
  AND NOT EXISTS (
    SELECT 1 FROM "coin_purchases"
    WHERE "player_id" = 'luke' AND "item_id" = 'a-storm-is-brewing'
  );
