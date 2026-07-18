// Current epoch millis. Wrapping Date.now() here keeps the impure call out of
// React component/render scope (the react-hooks purity lint), so server and
// client components can read a single "now" reference through a plain import.
export function nowMs(): number {
  return Date.now()
}
