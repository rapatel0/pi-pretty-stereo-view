/**
 * In-package event bridges that keep layout owners from stepping on each
 * other. The sidebar must wrap the layout root the stereo split already
 * mounted, and it must be released before the stereo layout disposes, so the
 * two pieces of the same package coordinate here instead of guessing order.
 */

type Listener = () => void;

const attachedListeners = new Set<Listener>();
const detachingListeners = new Set<Listener>();
let stereoAttached = false;

export function onStereoAttached(listener: Listener): () => void {
  attachedListeners.add(listener);
  return () => attachedListeners.delete(listener);
}

export function onStereoDetaching(listener: Listener): () => void {
  detachingListeners.add(listener);
  return () => detachingListeners.delete(listener);
}

export function isStereoAttached(): boolean {
  return stereoAttached;
}

export function markStereoAttached(): void {
  stereoAttached = true;
  for (const listener of [...attachedListeners]) listener();
}

export function markStereoDetaching(): void {
  stereoAttached = false;
  for (const listener of [...detachingListeners]) listener();
}
