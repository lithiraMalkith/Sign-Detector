import * as T from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { repairThumbGaps } from './repairThumbGaps';
export type Mode = 'original' | 'normals' | 'linear' | 'rounded';
const clamp = T.MathUtils.clamp;
function handMask(g: T.BufferGeometry, s: T.Skeleton, i: number) {
    let sum = 0;
    for (let k = 0; k < 4; k++)
        if (/(?:Hand|Finger)/.test(s.bones[g.attributes.skinIndex.getComponent(i, k)]?.name || ''))
            sum += g.attributes.skinWeight.getComponent(i, k);
    return clamp((sum - .9) / .1, 0, 1);
}
// Join normal calculations across UV splits only when skin influences also agree.
function normalKeys(g: T.BufferGeometry) {
    const p = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    return Array.from({ length: p.count }, (_, i) => {
        const weights = Array.from({ length: 4 }, (_, k) => [si.getComponent(i, k), sw.getComponent(i, k)]).filter(v => v[1] > 1e-6).sort((a, b) => a[0] - b[0]);
        return [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e5)).join(',') + '|' + weights.map(w => w[0] + ':' + Math.round(w[1] * 1e5)).join(',');
    });
}
function smoothNormals(g: T.BufferGeometry, s: T.Skeleton) {
    const old = g.attributes.normal.clone();
    g.computeVertexNormals();
    const n = g.attributes.normal, keys = normalKeys(g), sums = new Map<string, T.Vector3>();
    for (let i = 0; i < n.count; i++) {
        const v = new T.Vector3().fromBufferAttribute(n, i);
        const sum = sums.get(keys[i]);
        if (sum)
            sum.add(v);
        else
            sums.set(keys[i], v);
    }
    for (let i = 0; i < n.count; i++) {
        const v = new T.Vector3().fromBufferAttribute(old, i).lerp(sums.get(keys[i])!.clone().normalize(), handMask(g, s, i)).normalize();
        n.setXYZ(i, v.x, v.y, v.z);
    }
    n.needsUpdate = true;
}
export function makeHandGeometry(source: T.BufferGeometry, skeleton: T.Skeleton, mode: Mode, levels = 1, rounding = .75, repairGaps = true) {
    const started = performance.now(), originalTriangles = (source.index?.count || source.attributes.position.count) / 3;
    if (!source.attributes.skinIndex || !source.attributes.skinWeight)
        throw new Error('Hand skin attributes missing');
    if (Object.keys(source.morphAttributes).length)
        throw new Error('Morph-bearing meshes require a different subdivision path');
    const repair = repairGaps && mode !== 'original' ? repairThumbGaps(source, skeleton) : { geometry: source.clone(), report: { patchedHoles: 0, addedTriangles: 0, patches: [] } };
    let g = repair.geometry, maxDiscardedWeight = 0, maxStep = 0;
    if (mode !== 'original')
        smoothNormals(g, skeleton);
    if (mode === 'linear' || mode === 'rounded')
        for (let level = 0; level < clamp(levels, 1, 2); level++) {
            const indexed = mergeVertices(g, 1e-6);
            g.dispose();
            g = indexed;
            const attributes = Object.entries(g.attributes), arrays: Record<string, number[]> = {};
            for (const [name, a] of attributes)
                arrays[name] = Array.from(a.array);
            const pos = g.attributes.position, norm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
            const edges = new Map<string, number>(), indices: number[] = [];
            let count = pos.count;
            const midpoint = (a: number, b: number) => {
                const key = a < b ? a + ',' + b : b + ',' + a;
                const known = edges.get(key);
                if (known !== undefined)
                    return known;
                const id = count++;
                edges.set(key, id);
                for (const [name, attr] of attributes) {
                    if (name === 'skinIndex' || name === 'skinWeight')
                        continue;
                    for (let k = 0; k < attr.itemSize; k++)
                        arrays[name].push((attr.getComponent(a, k) + attr.getComponent(b, k)) * .5);
                }
                const influences = new Map<number, number>();
                for (const i of [a, b])
                    for (let k = 0; k < 4; k++) {
                        const bone = si.getComponent(i, k);
                        influences.set(bone, (influences.get(bone) || 0) + sw.getComponent(i, k) * .5);
                    }
                const all = [...influences].filter(v => v[1] > 1e-10).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
                const top = all.slice(0, 4), total = top.reduce((acc, v) => acc + v[1], 0);
                maxDiscardedWeight = Math.max(maxDiscardedWeight, all.slice(4).reduce((acc, v) => acc + v[1], 0));
                if (total <= 0)
                    throw new Error('Invalid skin weight sum');
                for (let k = 0; k < 4; k++) {
                    arrays.skinIndex.push(top[k]?.[0] || 0);
                    arrays.skinWeight.push((top[k]?.[1] || 0) / total);
                }
                const pa = new T.Vector3().fromBufferAttribute(pos, a), pb = new T.Vector3().fromBufferAttribute(pos, b), p = pa.clone().add(pb).multiplyScalar(.5), na = new T.Vector3().fromBufferAttribute(norm, a).normalize(), nb = new T.Vector3().fromBufferAttribute(norm, b).normalize();
                if (mode === 'rounded') {
                    // Mid-edge Phong tangent-plane projection. Existing vertices stay fixed.
                    const delta = na.clone().multiplyScalar(-p.clone().sub(pa).dot(na) * .5).addScaledVector(nb, -p.clone().sub(pb).dot(nb) * .5);
                    delta.multiplyScalar(clamp(rounding, 0, 1) * Math.min(handMask(g, skeleton, a), handMask(g, skeleton, b)));
                    delta.clampLength(0, pa.distanceTo(pb) * .1);
                    maxStep = Math.max(maxStep, delta.length());
                    p.add(delta);
                    arrays.position.splice(id * 3, 3, p.x, p.y, p.z);
                }
                const nn = na.add(nb).normalize();
                arrays.normal.splice(id * 3, 3, nn.x, nn.y, nn.z);
                return id;
            };
            for (let i = 0; i < g.index!.count; i += 3) {
                const a = g.index!.getX(i), b = g.index!.getX(i + 1), c = g.index!.getX(i + 2), ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
                indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
            }
            const next = new T.BufferGeometry();
            for (const [name, a] of attributes)
                next.setAttribute(name, name === 'skinIndex' ? new T.Uint16BufferAttribute(arrays[name], a.itemSize) : new T.Float32BufferAttribute(arrays[name], a.itemSize));
            next.setIndex(indices);
            for (const group of g.groups)
                next.addGroup(group.start * 4, group.count * 4, group.materialIndex);
            next.name = g.name;
            g.dispose();
            g = next;
        }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    let badWeights = 0;
    for (let i = 0; i < g.attributes.position.count; i++) {
        let sum = 0;
        for (let k = 0; k < 4; k++)
            sum += g.attributes.skinWeight.getComponent(i, k);
        if (Math.abs(sum - 1) > 1e-4)
            badWeights++;
    }
    return { geometry: g, report: { mode, levels: mode === 'linear' || mode === 'rounded' ? levels : 0, rounding, originalTriangles, repair: repair.report, triangles: (g.index?.count || g.attributes.position.count) / 3, vertices: g.attributes.position.count, maxDiscardedWeight, maxStepLocalUnits: maxStep, badWeights, buildMs: performance.now() - started } };
}
