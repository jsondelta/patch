import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(__dirname, '..', 'wasm', 'patch.wasm')
const wasmBuffer = readFileSync(wasmPath)
const wasmModule = new WebAssembly.Module(wasmBuffer)
const wasmInstance = new WebAssembly.Instance(wasmModule)
const wasm = wasmInstance.exports

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function callWasm(fn, ...jsonArgs) {
  const buffers = jsonArgs.map(arg => encoder.encode(JSON.stringify(arg)))
  const ptrs = buffers.map(buf => {
    const ptr = wasm.alloc(buf.length)
    if (!ptr) throw new Error('wasm allocation failed')
    new Uint8Array(wasm.memory.buffer).set(buf, ptr)
    return { ptr, len: buf.length }
  })

  const args = ptrs.flatMap(p => [p.ptr, p.len])
  const resultLen = fn(...args)

  for (const p of ptrs) wasm.dealloc(p.ptr, p.len)

  if (resultLen < 0) throw new Error('wasm operation failed')

  const resultPtr = wasm.getResultPtr()
  const resultBytes = new Uint8Array(wasm.memory.buffer.slice(resultPtr, resultPtr + resultLen))
  const result = JSON.parse(decoder.decode(resultBytes))

  wasm.freeResult()
  return result
}

/**
 * Apply a delta to a document using the Zig WASM engine.
 * @param {*} doc - Source document (JSON-compatible value)
 * @param {Array<Object>} delta - Array of operations from @jsondelta/diff
 * @returns {*} Patched document
 */
function patch(doc, delta) {
  return callWasm(wasm.patch, doc, delta)
}

/**
 * Invert a delta using the Zig WASM engine.
 * @param {Array<Object>} delta - Array of operations from @jsondelta/diff
 * @returns {Array<Object>} Inverted delta
 */
function invert(delta) {
  return callWasm(wasm.invert, delta)
}

export { patch, invert }
