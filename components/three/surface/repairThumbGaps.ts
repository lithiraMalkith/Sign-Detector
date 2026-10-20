import * as T from 'three';
import { topology, type BoundaryEdge, type BoundaryComponent } from './topology';
// Close only small, closed thumb/hand boundary loops. The cuff boundaries have
// forearm weights and are deliberately left open. UV and skin splits stay intact.
export function repairThumbGaps(source: T.BufferGeometry, skeleton: T.Skeleton) {
    const g = source.clone(), t = topology(g), added: number[] = [], patches: {
        boundaryVertices: number;
        addedTriangles: number;
        center: number[];
        sourceVertices: number[];
    }[] = [];
    const p = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    // Two left-thumb triangles share one corner. Treat their simple cycles
    // separately rather than capping across the intervening valid surface.
    const loops: BoundaryComponent[] = [];
    for (const component of t.components) {
        const remaining = new Set<BoundaryEdge>(component.edges);
        const path = (start: number, current: number, seen: Set<number>, chain: BoundaryEdge[]): BoundaryEdge[] | null => {
            if (current === start)
                return chain.length >= 3 ? chain : null;
            if (seen.has(current))
                return null;
            const nextSeen = new Set(seen);
            nextSeen.add(current);
            for (const edge of remaining) {
                if (edge.a !== current || chain.includes(edge))
                    continue;
                const found = path(start, edge.b, nextSeen, [...chain, edge]);
                if (found)
                    return found;
            }
            return null;
        };
        while (remaining.size) {
            const first = [...remaining][0], chain = path(first.a, first.b, new Set([first.a]), [first]);
            if (!chain)
                break;
            chain.forEach(e => remaining.delete(e));
            loops.push({ ...component, edges: chain });
        }
    }
    for (const component of loops) {
        if (component.edges.length < 3 || component.edges.length > 6 || Math.max(...component.size) > 3)
            continue;
        const validWeights = component.edges.every((e: BoundaryEdge) => [e.va, e.vb].every(i => [0, 1, 2, 3].reduce((sum, k) => sum + (/^Bip\d+_[LR]_(Hand|Finger0[12]?)$/.test(skeleton.bones[si.getComponent(i, k)]?.name || '') ? sw.getComponent(i, k) : 0), 0) > .95));
        if (!validWeights)
            continue;
        const edges = component.edges;
        let edge = edges[0];
        const chain: BoundaryEdge[] = [];
        const seen = new Set<number>();
        while (!seen.has(edge.a)) {
            seen.add(edge.a);
            chain.push(edge);
            const next = edges.filter((e: BoundaryEdge) => e.a === edge.b);
            if (next.length !== 1)
                break;
            edge = next[0];
        }
        if (chain.length !== edges.length || edge.a !== chain[0].a)
            continue;
        // Reversing the surrounding face boundary gives outward patch winding.
        const verts = chain.map(e => e.va).reverse(), points = verts.map(i => new T.Vector3().fromBufferAttribute(p, i));
        const normal = new T.Vector3();
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            normal.x += (a.y - b.y) * (a.z + b.z);
            normal.y += (a.z - b.z) * (a.x + b.x);
            normal.z += (a.x - b.x) * (a.y + b.y);
        }
        if (normal.lengthSq() < 1e-10)
            throw new Error('Degenerate thumb gap');
        normal.normalize();
        const axis = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)));
        const flat = points.map(v => axis === 0 ? new T.Vector2(v.y, v.z) : axis === 1 ? new T.Vector2(v.x, v.z) : new T.Vector2(v.x, v.y));
        const triangles = T.ShapeUtils.triangulateShape(flat, []);
        if (triangles.length !== verts.length - 2)
            throw new Error('Thumb patch triangulation failed');
        const patch: number[] = [];
        for (const [a, b, c] of triangles) {
            const cross = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));
            if (cross.lengthSq() < 1e-12)
                throw new Error('Degenerate repair triangle');
            patch.push(...(cross.dot(normal) > 0 ? [verts[a], verts[b], verts[c]] : [verts[a], verts[c], verts[b]]));
        }
        added.push(...patch);
        patches.push({ boundaryVertices: verts.length, addedTriangles: patch.length / 3, center: component.center, sourceVertices: verts });
    }
    if (added.length) {
        const indices = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
        const start = indices.length;
        g.setIndex([...indices, ...added]);
        if (g.groups.length) {
            const material = g.groups[0].materialIndex || 0;
            g.addGroup(start, added.length, material);
        }
        // Reject unexpected holes or reversed seams instead of hiding them with double-sided material.
        const after = topology(g);
        if (after.nonManifold !== t.nonManifold || after.inconsistentWinding !== t.inconsistentWinding)
            throw new Error('Repair introduces invalid topology');
        if (after.boundary.length !== t.boundary.length - patches.reduce((sum, r) => sum + r.boundaryVertices, 0))
            throw new Error('Repair did not close its boundary');
    }
    return { geometry: g, report: { patchedHoles: patches.length, addedTriangles: added.length / 3, patches } };
}
