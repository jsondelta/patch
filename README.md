<p align="center">
  <img src="logo.svg" width="128" height="128" alt="@jsondelta/patch">
</p>

<h1 align="center">@jsondelta/patch</h1>

<p align="center">
  Zig-powered JSON patch application and delta inversion. Apply diffs, undo changes, roundtrip losslessly.
</p>

<p align="center">
  <a href="https://github.com/jsondelta/patch/actions/workflows/test.yml"><img src="https://github.com/jsondelta/patch/actions/workflows/test.yml/badge.svg" alt="test"></a>
  <a href="https://www.npmjs.com/package/@jsondelta/patch"><img src="https://img.shields.io/npm/v/@jsondelta/patch" alt="npm"></a>
</p>

## Install

```
npm install @jsondelta/patch
```

## Usage

```js
import { patch, invert } from '@jsondelta/patch'

const doc = { name: 'alice', role: 'viewer', tags: ['staff'] }
const delta = [
  { op: 'replace', path: ['role'], old: 'viewer', new: 'admin' },
  { op: 'add', path: ['tags', 1], value: 'elevated' }
]

const updated = patch(doc, delta)
// { name: 'alice', role: 'admin', tags: ['staff', 'elevated'] }

const undone = patch(updated, invert(delta))
// { name: 'alice', role: 'viewer', tags: ['staff'] }
```

The default import selects the fastest available backend: WebAssembly or pure JS fallback. You can also import a specific backend directly:

```js
import { patch, invert } from '@jsondelta/patch/fallback'
import { patch, invert } from '@jsondelta/patch/wasm'
```

## Real-world examples

### Undo/redo in a collaborative editor

```js
import { diff } from '@jsondelta/diff'
import { patch, invert } from '@jsondelta/patch'

const undoStack = []

function applyEdit(doc, newDoc) {
  const delta = diff(doc, newDoc)
  undoStack.push(delta)
  return newDoc
}

function undo(doc) {
  const delta = undoStack.pop()
  return patch(doc, invert(delta))
}

let doc = { title: 'Draft', body: 'Hello' }
doc = applyEdit(doc, { title: 'Draft', body: 'Hello world' })
doc = applyEdit(doc, { title: 'Final', body: 'Hello world' })
doc = undo(doc)
// { title: 'Draft', body: 'Hello world' }
```

### Applying configuration patches from a remote source

```js
import { patch } from '@jsondelta/patch'

const baseConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const envPatch = await fetch('/api/config-patches/production').then(r => r.json())

const config = patch(baseConfig, envPatch)
```

## API

### `patch(doc, delta)`

Apply a delta to a document, returning the patched result. The original document is not mutated.

- `doc` - any JSON-compatible value
- `delta` - array of operations from `@jsondelta/diff`
- Returns the patched document

### `invert(delta)`

Reverse a delta so that applying the inverted delta undoes the original patch. Operations are flipped (`add` becomes `remove`, `remove` becomes `add`, `replace` swaps `old` and `new`) and the order is reversed.

- `delta` - array of operations from `@jsondelta/diff`
- Returns the inverted delta

## How it works

The patch engine is written in Zig and compiled to WebAssembly (73KB). It parses the document and delta, groups operations by path segment, and recursively rebuilds the document with changes applied. This grouping approach correctly handles all delta shapes from `@jsondelta/diff`, including multiple array removals.

The pure JS fallback implements the same algorithm for environments where WebAssembly is not available.

**Architecture:**
1. **WebAssembly** - Zig compiled to wasm32-freestanding. Near-native speed, runs in Node.js and browsers
2. **Pure JS fallback** - Zero-dependency, always works. Same algorithm, same output

## License

MIT
