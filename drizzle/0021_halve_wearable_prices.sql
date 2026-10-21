-- Pets, avatars and cosmetics are half price (rounded down), and the rarity
-- bands in `src/data/coin-rules.ts` were halved to match, so every item keeps
-- its rarity. Purchases keep the price paid; power-ups are unchanged.
UPDATE "shop_items"
SET "price" = "price" / 2, "updated_at" = now()
WHERE "category" IN ('pet', 'avatar', 'cosmetic');
