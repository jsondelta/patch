/**
 * Apply a delta to a document, returning the patched result.
 * @param {*} doc - Source document (JSON-compatible value)
 * @param {Array<Object>} delta - Array of operations from @jsondelta/diff
 * @returns {*} Patched document
 */
function patch(doc, delta) {
  if (delta.length === 0) return structuredClone(doc)
  return applyOps(doc, delta)
}

/**
 * Invert a delta so that applying the inverted delta undoes the original patch.
 * @param {Array<Object>} delta - Array of operations from @jsondelta/diff
 * @returns {Array<Object>} Inverted delta
 */
function invert(delta) {
  const result = []
  for (let i = delta.length - 1; i >= 0; i--) {
    const op = delta[i]
    if (op.op === 'add') {
      result.push({ op: 'remove', path: op.path, value: op.value })
    } else if (op.op === 'remove') {
      result.push({ op: 'add', path: op.path, value: op.value })
    } else if (op.op === 'replace') {
      result.push({ op: 'replace', path: op.path, old: op.new, new: op.old })
    }
  }
  return result
}

function applyOps(doc, ops) {
  const rootOps = ops.filter(op => op.path.length === 0)
  if (rootOps.length > 0) {
    const last = rootOps[rootOps.length - 1]
    if (last.op === 'replace') return structuredClone(last.new)
    if (last.op === 'add') return structuredClone(last.value)
    if (last.op === 'remove') return undefined
  }

  const grouped = groupByFirstSegment(ops)

  if (Array.isArray(doc)) {
    return rebuildArray(doc, grouped)
  }

  if (typeof doc === 'object' && doc !== null) {
    return rebuildObject(doc, grouped)
  }

  return doc
}

function groupByFirstSegment(ops) {
  const groups = new Map()
  for (const op of ops) {
    if (op.path.length === 0) continue
    const key = op.path[0]
    const mapKey = typeof key === 'number' ? `#${key}` : key
    if (!groups.has(mapKey)) groups.set(mapKey, { key, ops: [] })
    const subOp = { ...op, path: op.path.slice(1) }
    groups.get(mapKey).ops.push(subOp)
  }
  return groups
}

function rebuildArray(arr, grouped) {
  const removes = new Set()
  const adds = new Map()

  for (const [, { key, ops }] of grouped) {
    const idx = key
    for (const op of ops) {
      if (op.path.length === 0 && op.op === 'remove') removes.add(idx)
      if (op.path.length === 0 && op.op === 'add' && idx >= arr.length) adds.set(idx, op.value)
    }
  }

  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (removes.has(i)) continue
    const mapKey = `#${i}`
    if (grouped.has(mapKey)) {
      result.push(applyOps(arr[i], grouped.get(mapKey).ops))
    } else {
      result.push(structuredClone(arr[i]))
    }
  }

  const addIndices = [...adds.keys()].sort((a, b) => a - b)
  for (const idx of addIndices) {
    result.push(structuredClone(adds.get(idx)))
  }

  return result
}

function rebuildObject(obj, grouped) {
  const result = {}
  const removes = new Set()
  const addKeys = new Map()

  for (const [, { key, ops }] of grouped) {
    for (const op of ops) {
      if (op.path.length === 0 && op.op === 'remove') removes.add(key)
      if (op.path.length === 0 && op.op === 'add' && !(key in obj)) addKeys.set(key, op.value)
    }
  }

  for (const key of Object.keys(obj)) {
    if (removes.has(key)) continue
    const mapKey = key
    if (grouped.has(mapKey)) {
      result[key] = applyOps(obj[key], grouped.get(mapKey).ops)
    } else {
      result[key] = structuredClone(obj[key])
    }
  }

  for (const [key, value] of addKeys) {
    result[key] = structuredClone(value)
  }

  return result
}

export { patch, invert }
