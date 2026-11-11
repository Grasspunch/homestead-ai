// How many agent calls the page is waiting on. While any is, <html> carries `hs-busy` and the paw shows its
// sand timer (hud/pointer.css). A count, not a flag, so two calls that overlap don't clear each other.

let waiting = 0

function mark() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('hs-busy', waiting > 0)
}

export async function waitingOn<T>(work: Promise<T>): Promise<T> {
  waiting++
  mark()
  try {
    return await work
  } finally {
    waiting--
    mark()
  }
}

export const busyCount = () => waiting
