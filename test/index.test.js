import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { patch as patchFallback, invert as invertFallback } from '../src/fallback.js'

const backends = [['fallback', patchFallback, invertFallback]]

try {
  const wasm = await import('../src/wasm.js')
  backends.push(['wasm', wasm.patch, wasm.invert])
} catch {}

for (const [name, patch, invert] of backends) {
  describe(`patch (${name})`, () => {
    it('returns identical doc for empty delta', () => {
      const doc = { a: 1, b: [2, 3] }
      assert.deepStrictEqual(patch(doc, []), doc)
    })

    it('applies add to object', () => {
      const doc = { a: 1 }
      const delta = [{ op: 'add', path: ['b'], value: 2 }]
      assert.deepStrictEqual(patch(doc, delta), { a: 1, b: 2 })
    })

    it('applies remove from object', () => {
      const doc = { a: 1, b: 2 }
      const delta = [{ op: 'remove', path: ['b'], value: 2 }]
      assert.deepStrictEqual(patch(doc, delta), { a: 1 })
    })

    it('applies replace in object', () => {
      const doc = { a: 1, b: 2 }
      const delta = [{ op: 'replace', path: ['b'], old: 2, new: 3 }]
      assert.deepStrictEqual(patch(doc, delta), { a: 1, b: 3 })
    })

    it('applies nested object operations', () => {
      const doc = { user: { name: 'alice', role: 'viewer' } }
      const delta = [{ op: 'replace', path: ['user', 'role'], old: 'viewer', new: 'admin' }]
      assert.deepStrictEqual(patch(doc, delta), { user: { name: 'alice', role: 'admin' } })
    })

    it('applies deeply nested operations', () => {
      const doc = { a: { b: { c: { d: 1 } } } }
      const delta = [{ op: 'replace', path: ['a', 'b', 'c', 'd'], old: 1, new: 2 }]
      assert.deepStrictEqual(patch(doc, delta), { a: { b: { c: { d: 2 } } } })
    })

    it('applies add to array (append)', () => {
      const doc = { tags: ['a', 'b'] }
      const delta = [{ op: 'add', path: ['tags', 2], value: 'c' }]
      assert.deepStrictEqual(patch(doc, delta), { tags: ['a', 'b', 'c'] })
    })

    it('applies remove from array', () => {
      const doc = { tags: ['a', 'b', 'c'] }
      const delta = [
        { op: 'replace', path: ['tags', 1], old: 'b', new: 'c' },
        { op: 'remove', path: ['tags', 2], value: 'c' }
      ]
      assert.deepStrictEqual(patch(doc, delta), { tags: ['a', 'c'] })
    })

    it('applies replace in array', () => {
      const doc = [1, 2, 3]
      const delta = [{ op: 'replace', path: [1], old: 2, new: 20 }]
      assert.deepStrictEqual(patch(doc, delta), [1, 20, 3])
    })

    it('handles multiple removes from array tail', () => {
      const doc = [1, 2, 3, 4]
      const delta = [
        { op: 'replace', path: [1], old: 2, new: 4 },
        { op: 'remove', path: [2], value: 3 },
        { op: 'remove', path: [3], value: 4 }
      ]
      assert.deepStrictEqual(patch(doc, delta), [1, 4])
    })

    it('handles array growing', () => {
      const doc = [1]
      const delta = [
        { op: 'add', path: [1], value: 2 },
        { op: 'add', path: [2], value: 3 }
      ]
      assert.deepStrictEqual(patch(doc, delta), [1, 2, 3])
    })

    it('handles mixed object adds and removes', () => {
      const doc = { a: 1, b: 2, c: 3 }
      const delta = [
        { op: 'remove', path: ['b'], value: 2 },
        { op: 'add', path: ['d'], value: 4 }
      ]
      assert.deepStrictEqual(patch(doc, delta), { a: 1, c: 3, d: 4 })
    })

    it('handles nested array in object', () => {
      const doc = { items: [{ name: 'a' }, { name: 'b' }] }
      const delta = [{ op: 'replace', path: ['items', 0, 'name'], old: 'a', new: 'x' }]
      assert.deepStrictEqual(patch(doc, delta), { items: [{ name: 'x' }, { name: 'b' }] })
    })

    it('handles object in array', () => {
      const doc = [{ x: 1 }, { x: 2 }]
      const delta = [{ op: 'add', path: [1, 'y'], value: 3 }]
      assert.deepStrictEqual(patch(doc, delta), [{ x: 1 }, { x: 2, y: 3 }])
    })

    it('replaces root value', () => {
      const doc = { a: 1 }
      const delta = [{ op: 'replace', path: [], old: { a: 1 }, new: { b: 2 } }]
      assert.deepStrictEqual(patch(doc, delta), { b: 2 })
    })

    it('handles type change via replace', () => {
      const doc = { val: 'string' }
      const delta = [{ op: 'replace', path: ['val'], old: 'string', new: 42 }]
      assert.deepStrictEqual(patch(doc, delta), { val: 42 })
    })

    it('handles null values', () => {
      const doc = { a: null }
      const delta = [{ op: 'replace', path: ['a'], old: null, new: 1 }]
      assert.deepStrictEqual(patch(doc, delta), { a: 1 })
    })

    it('handles boolean values', () => {
      const doc = { flag: true }
      const delta = [{ op: 'replace', path: ['flag'], old: true, new: false }]
      assert.deepStrictEqual(patch(doc, delta), { flag: false })
    })

    it('handles complex added values', () => {
      const doc = {}
      const delta = [{ op: 'add', path: ['nested'], value: { a: [1, 2, { b: 3 }] } }]
      assert.deepStrictEqual(patch(doc, delta), { nested: { a: [1, 2, { b: 3 }] } })
    })

    it('does not mutate original document', () => {
      const doc = { a: 1, b: { c: 2 } }
      const delta = [{ op: 'replace', path: ['b', 'c'], old: 2, new: 3 }]
      patch(doc, delta)
      assert.deepStrictEqual(doc, { a: 1, b: { c: 2 } })
    })

    it('does not mutate delta', () => {
      const delta = [{ op: 'replace', path: ['a'], old: 1, new: 2 }]
      const copy = JSON.parse(JSON.stringify(delta))
      patch({ a: 1 }, delta)
      assert.deepStrictEqual(delta, copy)
    })
  })

  describe(`invert (${name})`, () => {
    it('inverts add to remove', () => {
      const delta = [{ op: 'add', path: ['b'], value: 2 }]
      const inv = invert(delta)
      assert.deepStrictEqual(inv, [{ op: 'remove', path: ['b'], value: 2 }])
    })

    it('inverts remove to add', () => {
      const delta = [{ op: 'remove', path: ['b'], value: 2 }]
      const inv = invert(delta)
      assert.deepStrictEqual(inv, [{ op: 'add', path: ['b'], value: 2 }])
    })

    it('inverts replace by swapping old and new', () => {
      const delta = [{ op: 'replace', path: ['a'], old: 1, new: 2 }]
      const inv = invert(delta)
      assert.deepStrictEqual(inv, [{ op: 'replace', path: ['a'], old: 2, new: 1 }])
    })

    it('reverses operation order', () => {
      const delta = [
        { op: 'replace', path: ['a'], old: 1, new: 2 },
        { op: 'add', path: ['b'], value: 3 }
      ]
      const inv = invert(delta)
      assert.strictEqual(inv.length, 2)
      assert.strictEqual(inv[0].op, 'remove')
      assert.deepStrictEqual(inv[0].path, ['b'])
      assert.strictEqual(inv[1].op, 'replace')
      assert.deepStrictEqual(inv[1].path, ['a'])
    })

    it('roundtrips: patch(doc, delta) then patch(result, invert(delta)) returns original', () => {
      const doc = { name: 'alice', role: 'viewer', tags: ['staff'] }
      const delta = [
        { op: 'replace', path: ['role'], old: 'viewer', new: 'admin' },
        { op: 'add', path: ['tags', 1], value: 'elevated' }
      ]
      const patched = patch(doc, delta)
      const restored = patch(patched, invert(delta))
      assert.deepStrictEqual(restored, doc)
    })

    it('roundtrips with nested changes', () => {
      const doc = { a: { b: 1, c: 2 }, d: [10, 20] }
      const delta = [
        { op: 'replace', path: ['a', 'b'], old: 1, new: 99 },
        { op: 'remove', path: ['a', 'c'], value: 2 },
        { op: 'add', path: ['d', 2], value: 30 }
      ]
      const patched = patch(doc, delta)
      const restored = patch(patched, invert(delta))
      assert.deepStrictEqual(restored, doc)
    })

    it('roundtrips with array shrink', () => {
      const doc = [1, 2, 3, 4]
      const delta = [
        { op: 'replace', path: [1], old: 2, new: 4 },
        { op: 'remove', path: [2], value: 3 },
        { op: 'remove', path: [3], value: 4 }
      ]
      const patched = patch(doc, delta)
      assert.deepStrictEqual(patched, [1, 4])
      const restored = patch(patched, invert(delta))
      assert.deepStrictEqual(restored, doc)
    })

    it('inverts empty delta', () => {
      assert.deepStrictEqual(invert([]), [])
    })

    it('roundtrips complex nested document', () => {
      const doc = {
        users: [
          { id: 1, name: 'alice', perms: ['read'] },
          { id: 2, name: 'bob', perms: ['read', 'write'] }
        ],
        meta: { version: 1 }
      }
      const delta = [
        { op: 'replace', path: ['users', 0, 'name'], old: 'alice', new: 'ALICE' },
        { op: 'add', path: ['users', 0, 'perms', 1], value: 'admin' },
        { op: 'replace', path: ['meta', 'version'], old: 1, new: 2 }
      ]
      const patched = patch(doc, delta)
      const restored = patch(patched, invert(delta))
      assert.deepStrictEqual(restored, doc)
    })
  })
}
