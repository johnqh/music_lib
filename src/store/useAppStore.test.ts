import { describe, expect, it } from "vitest";
import { testStoreContext } from "../test/store-context.js";
import { createAppStore } from "./useAppStore.js";
import { changeMetadataCommand } from "../domain/commands/structure-commands.js";
import { twinkleScore } from "../test/fixtures.js";
import type { GenerateScoreRequest } from "@sudobility/music_types";

const REQUEST: GenerateScoreRequest = {
  prompt: "Create a gentle eight-measure piano piece in A minor",
  durationMeasures: 8,
  tracks: [
    { name: "Piano", instrumentName: "Piano", midiProgram: 0, clef: "treble" },
  ],
};

describe("useAppStore (integration)", () => {
  it("walks the spec §39 happy path across every slice: new project -> generate -> select+regenerate -> accept -> manual edit -> undo/redo -> save", async () => {
    const store = createAppStore({ context: testStoreContext() });

    // 1-2. Create a new project.
    await store.getState().newProject({ name: "A Minor Piece" });
    expect(store.getState().projectId).not.toBeNull();

    // 3-5. Generate a score from a prompt.
    await store.getState().generate(REQUEST);
    expect(store.getState().score?.tracks).toHaveLength(1);
    expect(store.getState().dirty).toBe(true);

    // 8-9. Selecting a region puts generation in 'regenerate' mode. The
    // regeneration itself is a server-side job now (see music_api's jobs
    // routes and the app's useGenerationJob), so this store no longer runs
    // it; what it still owns is the mode and the regenerated-selection mark.
    const measureId = store.getState().score!.tracks[0].measures[0].id;
    store.getState().selectMeasures([measureId]);
    expect(store.getState().mode).toBe("regenerate");

    // 10-13. What a finished job hands back: the notes it wrote, marked so
    // the editor colours them as generated material.
    const { allNotes } = await import("../domain/score/queries.js");
    const written = allNotes(store.getState().score!).slice(0, 2);
    store.getState().selectRegenerated(written.map((n) => n.id));
    expect(store.getState().selectionRegenerated).toBe(true);

    // 14-15. Manual edit, then undo/redo.
    const noteId = store
      .getState()
      .score!.tracks[0].measures[1].voices[0].events.find(
        (e) => "pitch" in e,
      )?.id;
    expect(noteId).toBeDefined();
    const { changeVelocityCommand } =
      await import("../domain/commands/note-commands.js");
    store.getState().dispatchCommand(changeVelocityCommand([noteId!], 100));
    const findNote = () =>
      store
        .getState()
        .score!.tracks[0].measures[1].voices[0].events.find(
          (e) => e.id === noteId,
        ) as {
        velocity: number;
      };
    expect(findNote().velocity).toBe(100);

    store.getState().undo();
    expect(findNote().velocity).not.toBe(100);

    store.getState().redo();
    expect(findNote().velocity).toBe(100);

    // 16. Change the active track (ui-slice) — a purely orthogonal concern.
    store.getState().setActiveTrack(store.getState().score!.tracks[0].id);
    expect(store.getState().activeTrackId).toBe(
      store.getState().score!.tracks[0].id,
    );

    // Save.
    await store.getState().saveNow();
    expect(store.getState().saveState).toBe("saved");
    expect(store.getState().dirty).toBe(false);

    // 25. No uncaught errors: generation-slice's error stayed clear throughout.
    expect(store.getState().error).toBeNull();
  });

  it("createAppStore constructs against an injected context without throwing", () => {
    expect(() => createAppStore({ context: testStoreContext() })).not.toThrow();
  });

  it("gives every store its own HistoryManager (no cross-store undo bleed)", async () => {
    {
      const storeA = createAppStore({ context: testStoreContext() });
      const storeB = createAppStore({ context: testStoreContext() });
      storeA.getState().setScore(twinkleScore());
      storeB.getState().setScore(twinkleScore());

      storeA
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "Store A only" }));

      expect(storeA.getState().canUndo).toBe(true);
      expect(storeB.getState().canUndo).toBe(false);
      expect(storeB.getState().score?.metadata.title).toBe(
        "Twinkle Twinkle Little Star",
      );
    }
  });
});
