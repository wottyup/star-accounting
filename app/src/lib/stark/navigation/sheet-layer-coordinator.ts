type RestoreLayer = () => Promise<void>;

type LayerSession = {
  owners: number;
  restoring: boolean;
  prepared: Promise<RestoreLayer>;
  ready: Promise<void>;
};

// A parent sheet and its pickers share one native-to-Web handoff. A new
// session waits for the previous restoration, including a close during load.
export function createSheetLayerCoordinator(prepare: () => Promise<RestoreLayer>) {
  let current: LayerSession | null = null;
  let previousRestore = Promise.resolve();

  return function acquire() {
    if (!current) {
      const prepared = previousRestore.then(prepare).catch(() => async () => {});
      current = { owners: 0, restoring: false, prepared, ready: prepared.then(() => {}) };
    }
    const session = current;
    session.owners += 1;
    let released = false;

    return {
      ready: session.ready,
      async release() {
        if (released) return;
        released = true;
        session.owners -= 1;
        // React Strict Mode can immediately reacquire the same mounted layer.
        await Promise.resolve();
        if (session.owners || session.restoring) return;
        session.restoring = true;
        if (current === session) current = null;
        previousRestore = session.prepared.then((restore) => restore()).catch(() => {});
        await previousRestore;
      },
    };
  };
}
