import { patch as fallbackPatch, invert as fallbackInvert } from './fallback.js'

let patch = fallbackPatch
let invert = fallbackInvert
let backend = 'fallback'

try {
  const wasm = await import('./wasm.js')
  patch = wasm.patch
  invert = wasm.invert
  backend = 'wasm'
} catch {
  // using fallback
}

export { patch, invert, backend }
