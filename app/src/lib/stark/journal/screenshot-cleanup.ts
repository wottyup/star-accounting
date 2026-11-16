export type ScreenshotRemoval = { status: string };

/** Run only after every entry was saved. Cleanup failures never become save failures. */
export async function finishScreenshotCleanup(sourceId: string | undefined, actions: {
  confirm: () => Promise<boolean>;
  remove: (id: string) => Promise<ScreenshotRemoval>;
  forget: (id: string) => Promise<void>;
  unavailable: () => Promise<unknown>;
}) {
  if (!sourceId) return;
  try {
    if (await actions.confirm()) {
      const result = await actions.remove(sourceId);
      if (result.status !== "deleted" && result.status !== "cancelled") await actions.unavailable();
    }
  } catch {
    await actions.unavailable().catch(() => undefined);
  } finally {
    await actions.forget(sourceId).catch(() => undefined);
  }
}
