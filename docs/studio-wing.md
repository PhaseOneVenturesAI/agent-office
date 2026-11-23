# Studio wing

Back to the [README](../README.md).

A walk-in annex behind the office's north wall: a connecting hallway and three glass-walled studios —
**Marketing**, **Product** and **Development** — added without moving any existing desk, seat, board or
prop. It is the connected studio wing: you walk there through a real doorway, not a floor select or an
elevator stop.

## Where it is

- The doorway is through the north wall in the gap between the **task-queue board** and the **PR board**,
  marked *🎨 Studio Wing* with sliding glass doors that open as you come up, like the meeting room's.
- Behind the wall a hallway runs the width of the annex (22 m), with a standing **Studio Wing directory**,
  a runner rug and pendant lamps.
- Three glass-walled studios open off the hallway's north side, west to east:
  the **Marketing studio** (📣 moodboard easel, swatches, prop shelf, table and poufs),
  the **Product studio** (🛠️ roadmap planning board, planning table with sticky notes) and
  the **Development studio** (⚙️ three-monitor engineering bench, server rack, cable spools).
  Each has a glass sliding door, a chunky sign, a window in the back wall and a corner plant.
- Walk up to any studio sign (or the directory) and press **E**: it opens the floor's existing
  Departments panel (the directory's own interaction). The studios are set dressing — no fake
  functioning lead agents.

## The one moved prop (before / after)

The north wall's only clean, board-free span at door height is the gap between the queue and PR boards,
and the **PR board's kiosk** (`station-pulls`) stood dead-center in it. To form a usable entrance the
kiosk moved **1.2 m east, from x 0 to x 2.3** — still on the north wall, now in front of the PR board's
west end, still facing the room. Its board agent's pairing, label and prompts are unchanged, and the
Issues and Queue kiosks did not move. Nothing else in the office moved: every desk and pod, the lounge,
the elevator, the gong, the boards and the plants are exactly where they were.

## What had to change to support it

- `shared/studio-wing.ts` (new): the doorway, annex bounds, the three rooms, the prop footprints, and
  `STUDIO_WING_FLOOR` — the slab collider that holds you up inside the annex. Without it the annex has
  no ground and you drop to the street below (found in preview; there is a regression test).
- `shared/layout.ts`: the `station-pulls` kiosk's `x` (0 → 2.3), one comment.
- `shared/nav.ts`: the office nav grid reaches the annex; its floorplan adds the hallway, the studio
  interiors and the inclusive doorway seam, and its obstacles add the glass walls, partitions and prop
  footprints. The grid stays anchored where each wing level put it, so existing routes are untouched;
  the dog and sent-home workers can now wander in.
- `world/office/shell.ts`: the north wall takes the doorway as an opening (one line + import).
- `world/office/studio-wing.ts` (new): the fixture that builds the annex, and its line in
  `world/office/build.ts`'s plan (next to the back office's).
- `player/camera.ts`: the third-person camera treats the annex as indoors, like the back office.

The annex stays west of the back office's bay (WING), so building the back office out row by row is
unaffected at every level, and its back wall keeps 1.3 m clear of the sidewalk behind the building.

## Integration seams (owned elsewhere)

- The studio signs and the directory reuse the Departments panel via its existing `departments`
  interaction — they don't open per-studio scoping. Mapping rooms to departments (including a
  `development` preset, which doesn't exist yet) is a follow-up for the departments workstream.
- The existing **department directory** (by the elevator) is untouched; this wing's directory is its own
  physical sign in the hallway.

## Tests and preview

`tests/studio-wing.test.ts` pins the desk/seat preservation, the annex's fit inside the city block, the
walkable doorway seam, strict walkability of every route from the office to each studio and back at all
wing levels, the glass staying solid, and `groundAt` holding you up inside the annex.

Local preview (temporary fixture state, never production data):

```sh
npm run build
npx tsx src/server/cli.ts <any temp git repo> --port 4731 --password office-studio-wing-preview --no-open
# open http://localhost:4731/?3d=1
```

Preview evidence (screenshots incl. a real keyboard walk through the doorway, feet staying at y 0) is
kept in the coordination workspace under `outputs/office-studio-wing-v1/`.
