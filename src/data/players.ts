import type { Player } from "../types";

// Mock roster of 25 academy players. Replace with a Supabase query later;
// keep the exported shape (Player[]) stable so the UI does not change.
export const players: Player[] = [
  { id: "eva", name: "Eva", bio: "Conveniently inconvenient" },
  { id: "rebekah", name: "Rebekah", bio: "Good point for Rebekah?" },
  { id: "karen", name: "Karen", bio: "On your left! :D" },
  { id: "finnbar", name: "Finnbar", bio: "Reluctantly optimistic" },
  { id: "eve", name: "Eve", bio: "" },
  { id: "luke", name: "Luke", bio: "'I wish I was as cool as Luke' - everyone" },
  { id: "rose", name: "Rose", bio: "The Game is Afoot" },
  { id: "emma", name: "Emma", bio: "Always one step ahead..." },
  { id: "jack", name: "Jack", bio: "mediocre at all times" },
  { id: "caolan_d", name: "Caolãn D", bio: "My dog is called Loki" },
  { id: "erin", name: "Erin", bio: "gg freaking ez" },
  { id: "john", name: "John", bio: "48 cukes in my belly" },
  { id: "connor", name: "Connor", bio: "Lo siento Wilson" },
  { id: "sophia", name: "Sophia", bio: "" },
  { id: "orlagh", name: "Orlagh", bio: "I will never git it." },
  { id: "amelia", name: "Amelia", bio: "git master 🐦" },
  { id: "daire", name: "Daire", bio: "i have a wayyy smaller ego that y=ou. i have the smallest ego ever" },
  { id: "jake", name: "Jake", bio: "Tasks scatter like leaves\nJake gathers them one by one\nAutumn crowns a king" },
  { id: "ryan", name: "Ryan", bio: "MR GUY" },
  { id: "caolan_t", name: "Caolan T", bio: "Desperately trying" },
  { id: "criostoir", name: "Criostoir", bio: "one must imagine the best bio ever..." },
  { id: "eimhear", name: "Eimhear", bio: "The master of all the tasks" },
  { id: "grace", name: "Grace", bio: "AI's #1 fan" },
  { id: "adam", name: "Adam", bio: "the old guy - Amelia 2026" },
  { id: "andrew", name: "Andrew", bio: "Future taskmaster winner!!!" },
];

export function getPlayerById(id: string): Player | undefined {
  return players.find((p) => p.id === id);
}
