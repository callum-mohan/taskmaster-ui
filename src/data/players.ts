import type { Player } from "../types";

// Mock roster of 25 academy players. Replace with a Supabase query later;
// keep the exported shape (Player[]) stable so the UI does not change.
export const players: Player[] = [
  { id: "eva", name: "Eva", bio: "" },
  { id: "rebekah", name: "Rebekah", bio: "" },
  { id: "karen", name: "Karen", bio: "" },
  { id: "finnbar", name: "Finnbar", bio: "" },
  { id: "eve", name: "Eve", bio: "" },
  { id: "luke", name: "Luke", bio: "" },
  { id: "rose", name: "Rose", bio: "" },
  { id: "emma", name: "Emma", bio: "" },
  { id: "jack", name: "Jack", bio: "" },
  { id: "caolan_d", name: "Caolan D", bio: "" },
  { id: "erin", name: "Erin", bio: "" },
  { id: "john", name: "John", bio: "" },
  { id: "connor", name: "Connor", bio: "" },
  { id: "sophia", name: "Sophia", bio: "" },
  { id: "orlagh", name: "Orlagh", bio: "" },
  { id: "amelia", name: "Amelia", bio: "" },
  { id: "daire", name: "Daire", bio: "" },
  { id: "jake", name: "Jake", bio: "Tasks scatter like leaves\nJake gathers them one by one\nAutumn crowns a king" },
  { id: "ryan", name: "Ryan", bio: "" },
  { id: "caolan_t", name: "Caolan T", bio: "" },
  { id: "criostoir", name: "Criostoir", bio: "" },
  { id: "eimhear", name: "Eimhear", bio: "" },
  { id: "grace", name: "Grace", bio: "" },
  { id: "adam", name: "Adam", bio: "" },
  { id: "andrew", name: "Andrew", bio: "" },
];

export function getPlayerById(id: string): Player | undefined {
  return players.find((p) => p.id === id);
}
