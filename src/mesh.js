// Tetrahedral models for the demo. The app receives its tetrahedra from the engine; here they come
// from a structured grid split into 6 tetrahedra per cell (Kuhn / Freudenthal subdivision), which is
// conforming: two neighbouring cells split their shared face along the same diagonal.
import * as THREE from 'three'

const PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

function buildGridTetMesh({ cells, periodic = [false, false, false], map, mask = () => true }) {
  const [nx, ny, nz] = cells
  const sx = periodic[0] ? nx : nx + 1
  const sy = periodic[1] ? ny : ny + 1
  const sz = periodic[2] ? nz : nz + 1
  const gridIndex = (i, j, k) => ((i % sx) * sy + (j % sy)) * sz + (k % sz)

  const used = new Int32Array(sx * sy * sz).fill(-1)
  const nodes = []
  const nodeOf = (i, j, k) => {
    const g = gridIndex(i, j, k)
    if (used[g] < 0) {
      used[g] = nodes.length / 3
      const [x, y, z] = map(i / nx, j / ny, k / nz)
      nodes.push(x, y, z)
    }
    return used[g]
  }

  const tets = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        if (!mask(i, j, k, (i + 0.5) / nx, (j + 0.5) / ny, (k + 0.5) / nz)) continue
        for (const permutation of PERMUTATIONS) {
          const step = [0, 0, 0]
          const tet = [nodeOf(i, j, k)]
          for (const axis of permutation) {
            step[axis] = 1
            tet.push(nodeOf(i + step[0], j + step[1], k + step[2]))
          }
          tets.push(...tet)
        }
      }
  return { positions: Float32Array.from(nodes), indices: Uint32Array.from(tets) }
}

/** The boundary triangles of a tetrahedral mesh: faces used by one tetrahedron, wound outward. */
export function boundaryOf(positions, indices) {
  const faces = new Map()
  const n = positions.length / 3
  const faceTable = [
    [1, 2, 3, 0],
    [0, 2, 3, 1],
    [0, 1, 3, 2],
    [0, 1, 2, 3],
  ]
  for (let t = 0; t < indices.length / 4; t++) {
    for (const [a, b, c, opposite] of faceTable) {
      const f = [indices[t * 4 + a], indices[t * 4 + b], indices[t * 4 + c]]
      const s = [...f].sort((p, q) => p - q)
      const key = (s[0] * n + s[1]) * n + s[2]
      const known = faces.get(key)
      if (known) known.count++
      else faces.set(key, { count: 1, f, opposite: indices[t * 4 + opposite] })
    }
  }
  const out = []
  const p = i => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
  for (const { count, f, opposite } of faces.values()) {
    if (count !== 1) continue
    const [a, b, c] = f.map(p)
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    if (normal.dot(new THREE.Vector3().subVectors(p(opposite), a)) > 0) out.push(f[0], f[2], f[1])
    else out.push(f[0], f[1], f[2])
  }
  return Uint32Array.from(out)
}

export function fieldAt(x, y, z) {
  return 0.55 * Math.sin(2.1 * x + 0.5) * Math.cos(1.7 * z) + 0.45 * y + 0.18 * Math.sin(4 * y + x)
}

function cubeToBall(u, v, w) {
  const x = 2 * u - 1
  const y = 2 * v - 1
  const z = 2 * w - 1
  const r = 0.95
  return [
    r * x * Math.sqrt(1 - (y * y) / 2 - (z * z) / 2 + (y * y * z * z) / 3),
    r * y * Math.sqrt(1 - (z * z) / 2 - (x * x) / 2 + (z * z * x * x) / 3),
    r * z * Math.sqrt(1 - (x * x) / 2 - (y * y) / 2 + (x * x * y * y) / 3),
  ]
}

export const MODELS = {
  block: {
    label: 'Block (convex, 2 940 tets)',
    note: 'A 10 x 7 x 7 grid of cubes, 6 tetrahedra each. Node layers sit at y = -0.7, -0.5, ... 0.7.',
    build: () =>
      buildGridTetMesh({ cells: [10, 7, 7], map: (u, v, w) => [-1 + 2 * u, -0.7 + 1.4 * v, -0.7 + 1.4 * w] }),
  },
  ball: {
    label: 'Ball (curved)',
    note: 'A cube grid mapped onto a ball. Curved surface, still made of straight-edged tetrahedra.',
    build: () => buildGridTetMesh({ cells: [8, 8, 8], map: cubeToBall }),
  },
  ring: {
    label: 'Ring (concave, genus 1)',
    note: 'A thick annulus, periodic around its axis: a through-hole, so a horizontal cut gives a section with a hole.',
    build: () =>
      buildGridTetMesh({
        cells: [3, 40, 3],
        periodic: [false, true, false],
        map: (u, v, w) => {
          const r = 0.5 + 0.45 * u
          const t = 2 * Math.PI * v
          return [r * Math.cos(t), -0.3 + 0.6 * w, r * Math.sin(t)]
        },
      }),
  },
  bracket: {
    label: 'Bracket (concave, with a hole)',
    note: 'An L-shaped bracket with a square through-hole in its foot: concave corners and a section with a hole.',
    build: () =>
      buildGridTetMesh({
        cells: [12, 10, 5],
        map: (u, v, w) => [-1.2 + 2.4 * u, -1 + 2 * v, -0.5 + w],
        mask: (i, j, k, cu, cv) => {
          const x = -1.2 + 2.4 * cu
          const y = -1 + 2 * cv
          const inL = x < -0.4 || y < -0.2
          const inHole = Math.abs(x - 0.6) < 0.15 && Math.abs(y + 0.6) < 0.15
          return inL && !inHole
        },
      }),
  },
  parts: {
    label: 'Two parts (disconnected)',
    note: 'Two separate solids in one mesh. Each part gets its own closed cross-section.',
    build: () =>
      buildGridTetMesh({
        cells: [10, 6, 6],
        map: (u, v, w) => [-1.2 + 2.4 * u, -0.6 + 1.2 * v, -0.6 + 1.2 * w],
        mask: i => i < 4 || i >= 6,
      }),
  },
  edge: {
    label: 'Non-manifold edge',
    note: 'Two cubes that touch along one edge only. That edge has four boundary faces: the surface is not a 2-manifold there.',
    build: () =>
      buildGridTetMesh({
        cells: [8, 8, 4],
        map: (u, v, w) => [-1 + 2 * u, -1 + 2 * v, -0.4 + 0.8 * w],
        mask: (i, j) => (i < 4 && j < 4) || (i >= 4 && j >= 4),
      }),
  },
}

export function buildModel(key) {
  const { positions, indices } = MODELS[key].build()
  const surface = boundaryOf(positions, indices)
  const values = new Float32Array(positions.length / 3)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    values[i] = fieldAt(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    min = Math.min(min, values[i])
    max = Math.max(max, values[i])
  }
  const bounds = new THREE.Box3().setFromArray(positions)
  return { key, positions, indices, surface, values, min, max, bounds }
}
