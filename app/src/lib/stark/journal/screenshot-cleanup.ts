export type ScreenshotTrashResult = { status: string };

/** Run only after every entry was saved. Cleanup failures never become save failures. */
export async function finishScreenshotCleanup(sourceId: string | undefined, actions: {
  confirm: () => Promise<boolean>;
  trash: (id: string) => Promise<ScreenshotTrashResult>;
  forget: (id: string) => Promise<void>;
  unavailable: () => Promise<unknown>;
}) {
  if (!sourceId) return;
  try {
    if (await actions.confirm()) {
      const result = await actions.trash(sourceId);
      if (result.status !== "trashed" && result.status !== "cancelled") await actions.unavailable();
    }
  } catch {
    await actions.unavailable().catch(() => undefined);
  } finally {
    await actions.forget(sourceId).catch(() => undefined);
  }
}
