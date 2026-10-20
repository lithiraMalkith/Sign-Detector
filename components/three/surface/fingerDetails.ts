import * as T from 'three';
import { topology } from './topology';
function bindPoint(mesh: T.SkinnedMesh, index: number) { return new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[index].clone().invert()).applyMatrix4(mesh.bindMatrix.clone().invert()); }
function boneWeight(g: T.BufferGeometry, i: number, b: number) { let w = 0; for (let k = 0; k < 4; k++)
    if (g.attributes.skinIndex.getComponent(i, k) === b)
        w += g.attributes.skinWeight.getComponent(i, k); return w; }
// Small surface-following nail shells. Every point samples the actual finger
// triangles and inherits their interpolated skin influences, including the thumb.
export function makeNails(hand: T.SkinnedMesh) {
    const g = hand.geometry, p = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const pos: number[] = [], weights: number[] = [], bones: number[] = [], colours: number[] = [], indices: number[] = [], reports: {
        bone: string;
        added: boolean;
        reason?: string;
        vertices?: number;
        length?: number;
        width?: number;
    }[] = [];
    const idx = g.index, triangleCount = (idx?.count || p.count) / 3;
    for (let bi = 0; bi < hand.skeleton.bones.length; bi++) {
        const bone = hand.skeleton.bones[bi];
        if (!/_[LR]_Finger[0-4]2$/.test(bone.name))
            continue;
        const parentIndex = hand.skeleton.bones.indexOf(bone.parent as T.Bone);
        if (parentIndex < 0)
            continue;
        const origin = bindPoint(hand, bi), axis = origin.clone().sub(bindPoint(hand, parentIndex)).normalize();
        // These two QuickMagic exports use Z-up geometry in their bind coordinates.
        const dorsal = new T.Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize(), side = new T.Vector3().crossVectors(axis, dorsal).normalize();
        const points: T.Vector3[] = [];
        for (let i = 0; i < p.count; i++)
            if (boneWeight(g, i, bi) > .8)
                points.push(new T.Vector3().fromBufferAttribute(p, i).sub(origin));
        if (points.length < 5)
            continue;
        const length = Math.max(...points.map(v => v.dot(axis))), lateral = points.map(v => v.dot(side));
        const width = Math.max(...lateral) - Math.min(...lateral), midSide = (Math.max(...lateral) + Math.min(...lateral)) * .5;
        const subset: number[] = [], sourceTriangles: number[][] = [];
        for (let t = 0; t < triangleCount; t++) {
            const ids = [0, 1, 2].map(k => idx ? idx.getX(t * 3 + k) : t * 3 + k);
            if (ids.reduce((s, i) => s + boneWeight(g, i, bi), 0) / 3 > .55) {
                subset.push(...ids);
                sourceTriangles.push(ids);
            }
        }
        const patch = g.clone();
        patch.clearGroups();
        patch.setIndex(subset);
        const surface = new T.Mesh(patch, new T.MeshBasicMaterial({ side: T.DoubleSide }));
        surface.updateMatrixWorld(true);
        const ray = new T.Raycaster(), start = pos.length / 3, patchPoints: {
            v: T.Vector3;
            sorted: [
                number,
                number
            ][];
            total: number;
            color: T.Color;
        }[] = [], rings = 5, segments = 24;
        let failed = false;
        for (let ring = 0; ring <= rings; ring++) {
            const count = ring === 0 ? 1 : segments;
            for (let j = 0; j < count; j++) {
                const angle = j / segments * Math.PI * 2, r = ring / rings;
                const thumb = /Finger02$/.test(bone.name);
                const along = length * ((thumb ? .58 : .62) + (thumb ? .19 : .245) * r * Math.cos(angle)), across = midSide + width * (thumb ? .22 : .34) * r * Math.sin(angle);
                const base = origin.clone().addScaledVector(axis, along).addScaledVector(side, across);
                ray.set(base.clone().addScaledVector(dorsal, 5), dorsal.clone().negate());
                const hit = ray.intersectObject(surface, false)[0];
                if (!hit || hit.faceIndex == null) {
                    failed = true;
                    break;
                }
                const ids = sourceTriangles[hit.faceIndex], vertices = ids.map(i => new T.Vector3().fromBufferAttribute(p, i));
                const bary = new T.Vector3();
                T.Triangle.getBarycoord(hit.point, vertices[0], vertices[1], vertices[2], bary);
                const normal = hit.face!.normal.clone();
                if (normal.dot(dorsal) < 0)
                    normal.negate();
                const v = hit.point.clone().addScaledVector(normal, .025 + .012 * (1 - r * r));
                const influence = new Map<number, number>();
                ids.forEach((i, k) => { for (let c = 0; c < 4; c++) {
                    const b = si.getComponent(i, c), w = sw.getComponent(i, c) * bary.getComponent(k);
                    influence.set(b, (influence.get(b) || 0) + w);
                } });
                const sorted = [...influence].filter(x => x[1] > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4), total = sorted.reduce((s, v) => s + v[1], 0);
                const color = new T.Color(ring === rings ? '#c5a99a' : along > length * .79 ? '#eee1ce' : '#ddbeb1');
                patchPoints.push({ v, sorted, total, color });
            }
            if (failed)
                break;
        }
        patch.dispose();
        (surface.material as T.Material).dispose();
        if (failed) {
            reports.push({ bone: bone.name, added: false, reason: 'Surface projection missed; omitted rather than floating' });
            continue;
        }
        for (const { v, sorted, total, color } of patchPoints) {
            pos.push(...v.toArray());
            colours.push(color.r, color.g, color.b);
            for (let k = 0; k < 4; k++) {
                bones.push(sorted[k]?.[0] || 0);
                weights.push((sorted[k]?.[1] || 0) / total);
            }
        }
        for (let j = 0; j < segments; j++)
            indices.push(start, start + 1 + j, start + 1 + (j + 1) % segments);
        for (let r = 1; r < rings; r++)
            for (let j = 0; j < segments; j++) {
                const a = start + 1 + (r - 1) * segments + j, b = start + 1 + (r - 1) * segments + (j + 1) % segments, c = a + segments, d = b + segments;
                indices.push(a, c, b, b, c, d);
            }
        reports.push({ bone: bone.name, added: true, vertices: patchPoints.length, length, width });
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(bones, 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new T.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x24201d, shininess: 38, side: T.DoubleSide });
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.name = 'Fitted nails';
    mesh.frustumCulled = false;
    mesh.bind(hand.skeleton, hand.bindMatrix);
    hand.add(mesh);
    return { mesh, reports, dispose() { hand.remove(mesh); geometry.dispose(); material.dispose(); } };
}
// Bind-space tailoring only. This reduces cuff/hand overlap; it is not cloth
// collision simulation and cannot guarantee collision-free arbitrary gestures.
export function tailorCuffs(mesh: T.SkinnedMesh, amount = 1.6) {
    const g = mesh.geometry.clone(), p = g.attributes.position, si = g.attributes.skinIndex;
    const report: {
        side: string;
        changedVertices: number;
        maxMoveLocalUnits: number;
    }[] = [];
    for (const side of ['L', 'R']) {
        const hi = mesh.skeleton.bones.findIndex(b => b.name === `Bip001_${side}_Hand`), fi = mesh.skeleton.bones.findIndex(b => b.name === `Bip001_${side}_Forearm`);
        if (hi < 0 || fi < 0)
            continue;
        const wrist = bindPoint(mesh, hi), axis = wrist.clone().sub(bindPoint(mesh, fi)).normalize();
        let changed = 0, maxMove = 0;
        for (let i = 0; i < p.count; i++) {
            const v = new T.Vector3().fromBufferAttribute(p, i), relative = v.clone().sub(wrist), along = relative.dot(axis), radial = relative.clone().addScaledVector(axis, -along), radius = radial.length();
            if (along < -7 || along > 5 || radius > 6 || radius < .3)
                continue;
            const influence = boneWeight(g, i, hi) + boneWeight(g, i, fi);
            if (influence < .8)
                continue;
            const blend = T.MathUtils.smoothstep(along, -7, -.5), delta = axis.clone().multiplyScalar(-amount * blend).addScaledVector(radial.normalize(), .35 * blend);
            if (delta.length() < 1e-6)
                continue;
            v.add(delta);
            p.setXYZ(i, v.x, v.y, v.z);
            changed++;
            maxMove = Math.max(maxMove, delta.length());
            // A cuff follows the forearm rather than folding with the palm.
            for (let k = 0; k < 4; k++)
                if (si.getComponent(i, k) === hi)
                    si.setComponent(i, k, fi);
        }
        report.push({ side, changedVertices: changed, maxMoveLocalUnits: maxMove });
    }
    // Preserve authored normals (including hard clothing seams); the small
    // tapered adjustment does not justify smoothing the entire jacket.
    p.needsUpdate = true;
    si.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, report };
}
// Extend the open wrist skin boundary under the shortened sleeve, so tailoring
// cannot reveal the hollow end of the original hand mesh.
export function makeWristLining(hand: T.SkinnedMesh, amount: number) {
    const g = hand.geometry, t = topology(g), attrs = Object.entries(g.attributes), arrays: Record<string, number[]> = {};
    for (const [name] of attrs)
        arrays[name] = [];
    const indices: number[] = [];
    let count = 0;
    for (const component of t.components) {
        if (component.edges.length < 8)
            continue;
        const center = new T.Vector3().fromArray(component.center), candidates = hand.skeleton.bones.map((b, i) => ({ b, i })).filter(({ b }) => /_[LR]_Hand$/.test(b.name));
        candidates.sort((a, b) => bindPoint(hand, a.i).distanceTo(center) - bindPoint(hand, b.i).distanceTo(center));
        const hi = candidates[0]?.i;
        if (hi === undefined || bindPoint(hand, hi).distanceTo(center) > 5)
            continue;
        const fi = hand.skeleton.bones.findIndex(b => b.name === hand.skeleton.bones[hi].name.replace('_Hand', '_Forearm'));
        if (fi < 0)
            continue;
        const axis = bindPoint(hand, hi).sub(bindPoint(hand, fi)).normalize();
        for (const edge of component.edges) {
            const start = count;
            for (const [source, back] of [[edge.va, false], [edge.vb, false], [edge.va, true], [edge.vb, true]] as const) {
                for (const [name, a] of attrs)
                    for (let k = 0; k < a.itemSize; k++)
                        arrays[name].push(a.getComponent(source, k));
                if (back) {
                    const v = new T.Vector3().fromBufferAttribute(g.attributes.position, source).addScaledVector(axis, -amount - 2);
                    arrays.position.splice(count * 3, 3, ...v.toArray());
                    arrays.skinIndex.splice(count * 4, 4, fi, 0, 0, 0);
                    arrays.skinWeight.splice(count * 4, 4, 1, 0, 0, 0);
                }
                count++;
            }
            indices.push(start + 1, start, start + 2, start + 1, start + 2, start + 3);
        }
    }
    const geometry = new T.BufferGeometry();
    for (const [name, a] of attrs)
        geometry.setAttribute(name, name === 'skinIndex' ? new T.Uint16BufferAttribute(arrays[name], a.itemSize) : new T.Float32BufferAttribute(arrays[name], a.itemSize));
    geometry.setIndex(indices);
    const sourceMaterial = Array.isArray(hand.material) ? hand.material[0] : hand.material;
    const material = sourceMaterial.clone();
    material.onBeforeCompile = sourceMaterial.onBeforeCompile;
    material.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
    material.side = T.DoubleSide;
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.name = 'Wrist skin beneath tailored sleeve';
    mesh.frustumCulled = false;
    mesh.bind(hand.skeleton, hand.bindMatrix);
    hand.add(mesh);
    return { mesh, dispose() { hand.remove(mesh); geometry.dispose(); material.dispose(); } };
}
