import * as T from 'three';
export interface BoundaryEdge {
    a: number;
    b: number;
    va: number;
    vb: number;
    face: number;
}
export interface BoundaryComponent {
    edges: BoundaryEdge[];
    vertices: number[];
    center: number[];
    size: number[];
    positions: number[][];
}
export function topology(g: T.BufferGeometry) {
    const p = g.attributes.position, ids: number[] = [], points: T.Vector3[] = [], representatives: number[] = [], map = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
        const v = new T.Vector3().fromBufferAttribute(p, i), key = v.toArray().map(x => Math.round(x * 1e4)).join(',');
        let id = map.get(key);
        if (id === undefined) {
            id = points.length;
            points.push(v);
            representatives.push(i);
            map.set(key, id);
        }
        ids.push(id);
    }
    const edgeMap = new Map<string, {
        a: number;
        b: number;
        va: number;
        vb: number;
        face: number;
    }[]>();
    const count = g.index?.count || p.count;
    for (let k = 0; k < count; k += 3) {
        const v = [0, 1, 2].map(j => g.index ? g.index.getX(k + j) : k + j);
        for (let j = 0; j < 3; j++) {
            const va = v[j], vb = v[(j + 1) % 3], a = ids[va], b = ids[vb];
            if (a === b)
                continue;
            const key = a < b ? a + ',' + b : b + ',' + a;
            const list = edgeMap.get(key) || [];
            list.push({ a, b, va, vb, face: k / 3 });
            edgeMap.set(key, list);
        }
    }
    const boundary = [...edgeMap.values()].filter(x => x.length === 1).map(x => x[0]);
    const pending = new Set(boundary), components: BoundaryComponent[] = [];
    while (pending.size) {
        const initial = [...pending][0], stack = [initial], edges: BoundaryEdge[] = [];
        pending.delete(initial);
        while (stack.length) {
            const edge = stack.pop()!;
            edges.push(edge);
            for (const e of [...pending])
                if (e.a === edge.a || e.a === edge.b || e.b === edge.a || e.b === edge.b) {
                    pending.delete(e);
                    stack.push(e);
                }
        }
        const vertices = [...new Set(edges.flatMap(e => [e.a, e.b]))] as number[], box = new T.Box3().setFromPoints(vertices.map(i => points[i]));
        components.push({ edges, vertices, center: box.getCenter(new T.Vector3()).toArray(), size: box.getSize(new T.Vector3()).toArray(), positions: vertices.map(i => points[i].toArray()) });
    }
    return { ids, points, representatives, boundary, components, nonManifold: [...edgeMap.values()].filter(x => x.length > 2).length, inconsistentWinding: [...edgeMap.values()].filter(x => x.length === 2 && x[0].a === x[1].a).length };
}
