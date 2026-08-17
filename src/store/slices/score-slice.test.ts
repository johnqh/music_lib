import { describe, expect, it } from "vitest";
import { testStoreContext } from "../../test/store-context.js";
import { createAppStore } from "../useAppStore.js";
import {
  addMeasureCommand,
  changeMetadataCommand,
  changeTrackPropsCommand,
} from "../../domain/commands/structure-commands.js";
import { deleteEventsCommand } from "../../domain/commands/note-commands.js";
import { validateScore } from "../../domain/validation/validator.js";
import { twinkleScore } from "../../test/fixtures.js";

describe("score-slice", () => {
  describe("setScore", () => {
    it("adopts the score, recomputes validationIssues, and resets history by default", () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();

      store.getState().setScore(score);

      const state = store.getState();
      expect(state.score).toBe(score);
      expect(state.validationIssues).toEqual(validateScore(score));
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state.undoLabel).toBeNull();
      expect(state.redoLabel).toBeNull();
    });

    it("resolves a percussion track's program to a real kit on the way in", () => {
      // A MIDI file sets whatever program it likes on channel 10, and until
      // this the number was read as an instrument. Corrected inbound so the
      // picker never has to show something the score does not say.
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      const drums = { ...score.tracks[0], clef: "percussion" as const, midiProgram: 45 };

      store.getState().setScore({ ...score, tracks: [drums, ...score.tracks.slice(1)] });

      expect(store.getState().score?.tracks[0].midiProgram).toBe(40); // Brush
      expect(store.getState().score?.tracks[0].instrumentName).toBe("Brush Kit");
    });

    it("does not mark the project dirty for a correction the user did not make", () => {
      // Opening a project must not upload an edit. The correction rides along
      // with the user's next real one instead.
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      const drums = { ...score.tracks[0], clef: "percussion" as const, midiProgram: 45 };

      store.getState().setScore({ ...score, tracks: [drums, ...score.tracks.slice(1)] });

      expect(store.getState().dirty).toBe(false);
      expect(store.getState().saveState).not.toBe("unsaved");
    });

    it("clears any prior undo/redo history when resetHistory is not false", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "Renamed" }));
      expect(store.getState().canUndo).toBe(true);

      store.getState().setScore(twinkleScore());
      expect(store.getState().canUndo).toBe(false);
    });

    it("keeps existing history when resetHistory is false", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "Renamed" }));
      expect(store.getState().canUndo).toBe(true);

      store.getState().setScore(twinkleScore(), { resetHistory: false });
      expect(store.getState().canUndo).toBe(true);
    });

    it("resets the playback caret when adopting a new score", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().setCaretTick(1920);

      store.getState().setScore(twinkleScore());

      expect(store.getState().caretTick).toBe(0);
    });
  });

  describe("dispatchCommand", () => {
    it("runs the command, updates score/validationIssues, mirrors undo/redo state, and marks the project dirty", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());

      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "New Title" }));

      const state = store.getState();
      expect(state.score?.metadata.title).toBe("New Title");
      expect(state.canUndo).toBe(true);
      expect(state.undoLabel).toBe("Change metadata");
      expect(state.canRedo).toBe(false);
      expect(state.dirty).toBe(true);
      expect(state.saveState).toBe("unsaved");
    });

    it("is a no-op when there is no score loaded", () => {
      const store = createAppStore({ context: testStoreContext() });
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "New Title" }));
      expect(store.getState().score).toBeNull();
    });

    it("recomputes validationIssues after a mutation that changes the score", () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const firstNoteId = score.tracks[0].measures[0].voices[0].events[0].id;

      store.getState().dispatchCommand(deleteEventsCommand([firstNoteId]));

      const state = store.getState();
      expect(state.score).not.toBe(score);
      expect(state.validationIssues).toEqual(validateScore(state.score!));
    });
  });

  describe("undo/redo", () => {
    it("undo reverts the most recent command and updates the undo/redo mirrors", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "New Title" }));

      store.getState().undo();

      const state = store.getState();
      expect(state.score?.metadata.title).toBe("Twinkle Twinkle Little Star");
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(true);
      expect(state.redoLabel).toBe("Change metadata");
    });

    it("redo re-applies an undone command", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "New Title" }));
      store.getState().undo();

      store.getState().redo();

      const state = store.getState();
      expect(state.score?.metadata.title).toBe("New Title");
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);
    });

    it("undo/redo are no-ops when there is nothing to undo/redo", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      const before = store.getState().score;

      store.getState().undo();
      store.getState().redo();

      expect(store.getState().score).toBe(before);
    });

    it("marks the project dirty on undo and redo", () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store
        .getState()
        .dispatchCommand(changeMetadataCommand({ title: "New Title" }));
      store.setState((state) => {
        state.dirty = false;
        state.saveState = "saved";
      });

      store.getState().undo();
      expect(store.getState().dirty).toBe(true);

      store.setState((state) => {
        state.dirty = false;
        state.saveState = "saved";
      });
      store.getState().redo();
      expect(store.getState().dirty).toBe(true);
    });
  });
});

describe("the playback edit lock", () => {
  const freshStore = () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    return store;
  };

  it("refuses a content command while playing, leaving the score untouched", () => {
    const store = freshStore();
    const before = store.getState().score;
    store.getState().setPlaybackState("playing");

    store.getState().dispatchCommand(addMeasureCommand());

    expect(store.getState().score).toBe(before); // same reference: nothing ran
  });

  it("accepts a mix command while playing", () => {
    const store = freshStore();
    const trackId = store.getState().score!.tracks[0].id;
    store.getState().setPlaybackState("playing");

    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { muted: true }));

    expect(store.getState().score!.tracks[0].muted).toBe(true);
  });

  it("refuses undo and redo while playing", () => {
    const store = freshStore();
    store.getState().dispatchCommand(addMeasureCommand());
    const edited = store.getState().score;

    store.getState().setPlaybackState("playing");
    store.getState().undo();
    expect(store.getState().score).toBe(edited);
    store.getState().redo();
    expect(store.getState().score).toBe(edited);
  });

  it("accepts content again once playback stops", () => {
    const store = freshStore();
    store.getState().setPlaybackState("playing");
    store.getState().dispatchCommand(addMeasureCommand());
    store.getState().setPlaybackState("stopped");

    const before = store.getState().score;
    store.getState().dispatchCommand(addMeasureCommand());
    expect(store.getState().score).not.toBe(before);
  });

  it("does not mark the project dirty for a refused command", () => {
    // A refusal that still queued an autosave would upload an unchanged score.
    const store = freshStore();
    store.getState().setPlaybackState("playing");
    const dirtyBefore = store.getState().dirty;

    store.getState().dispatchCommand(addMeasureCommand());
    expect(store.getState().dirty).toBe(dirtyBefore);
  });
});
