import * as T from 'three';
// Average coincident authored normals without changing positions or morphs.
export function evenFaceGeometry(source: T.BufferGeometry) {
    const g = source.clone(), p = g.attributes.position, n = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const keys: string[] = [], sums = new Map<string, T.Vector3>();
    for (let i = 0; i < p.count; i++) {
        const weights = si && sw ? Array.from({ length: 4 }, (_, k) => [si.getComponent(i, k), sw.getComponent(i, k)]).filter(w => w[1] > 1e-6).sort((a, b) => a[0] - b[0]) : [];
        const key = [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e5)).join(',') + '|' + weights.map(w => w[0] + ':' + Math.round(w[1] * 1e5)).join(',');
        keys.push(key);
        const v = new T.Vector3().fromBufferAttribute(n, i);
        if (sums.has(key))
            sums.get(key)!.add(v);
        else
            sums.set(key, v);
    }
    for (let i = 0; i < n.count; i++) {
        const v = sums.get(keys[i])!.clone().normalize();
        n.setXYZ(i, v.x, v.y, v.z);
    }
    n.needsUpdate = true;
    return g;
}
export function restoredFaceMaterial(original: T.Material) {
    const source = original as T.MeshPhongMaterial;
    // Diffuse-only material: auxiliary maps on the imported material produce
    // the broad stripe. Share the original atlas; do not edit or dispose it.
    const material = new T.MeshPhongMaterial({ map: source.map, color: source.map ? 0xffffff : source.color, specular: 0x000000, shininess: 0, side: original.side, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest });
    // Keep the authored atlas: brows, lashes and lips share the skin material.
    // Fix the normal seam independently instead of painting over those features.
    material.name = original.name + ' — original facial details';
    return material;
}
