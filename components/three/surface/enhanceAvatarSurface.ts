import * as THREE from 'three';
import { makeHandGeometry } from './handGeometry';
import { evenFaceGeometry, restoredFaceMaterial } from './faceSurface';
import { makeNails, makeWristLining, tailorCuffs } from './fingerDetails';
import { HUMAN_SKIN, isBodySkinMaterial, warmPinkSkin } from './humanSkin';
export interface SurfaceReport {
    hands: ReturnType<typeof makeHandGeometry>['report'][];
    nails: ReturnType<typeof makeNails>['reports'];
    cuffs: ReturnType<typeof tailorCuffs>['report'];
}
/** Apply the reviewed surface treatment once, before exposing the loaded model.
 * Original FBX files, skeleton transforms, morph positions and clips stay intact.
 * All new meshes use the existing skeleton and are disposed by the model loader.
 */
export function enhanceAvatarSurface(scene: THREE.Group, avatar: 'girl' | 'boy') {
    const meshes: THREE.Mesh[] = [];
    scene.traverse(node => { if ((node as THREE.Mesh).isMesh)
        meshes.push(node as THREE.Mesh); });
    const replacements = new Map<THREE.Material, THREE.MeshPhongMaterial>();
    const report: SurfaceReport = { hands: [], nails: [], cuffs: [] };
    const replaceMaterials = (mesh: THREE.Mesh, transform: (m: THREE.MeshPhongMaterial) => THREE.MeshPhongMaterial) => {
        const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const next = original.map(m => {
            const existing = replacements.get(m);
            if (existing)
                return existing;
            if (!(m instanceof THREE.MeshPhongMaterial))
                return m;
            const changed = transform(m);
            if (changed !== m)
                replacements.set(m, changed);
            return changed;
        });
        mesh.material = Array.isArray(mesh.material) ? next : next[0];
    };
    for (const mesh of meshes) {
        if (/^(Head|face)$/i.test(mesh.name)) {
            const previous = mesh.geometry;
            mesh.geometry = evenFaceGeometry(previous);
            previous.dispose();
            replaceMaterials(mesh, m => /eye/i.test(m.name) ? m : warmPinkSkin(restoredFaceMaterial(m)));
        }
        else if (mesh.name === 'Gloves' && (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            const hand = mesh as THREE.SkinnedMesh, previous = hand.geometry;
            const result = makeHandGeometry(previous, hand.skeleton, 'rounded', 1, .75, true);
            hand.geometry = result.geometry;
            previous.dispose();
            report.hands.push(result.report);
            replaceMaterials(hand, m => { const skin = new THREE.MeshPhongMaterial({ color: HUMAN_SKIN, shininess: 24, side: m.side }); skin.name = m.name; return skin; });
            const nails = makeNails(hand);
            report.nails.push(...nails.reports);
            if (avatar === 'girl')
                makeWristLining(hand, 1.6);
        }
        else {
            replaceMaterials(mesh, m => isBodySkinMaterial(m) ? warmPinkSkin(m.clone()) : m);
        }
        if (avatar === 'girl' && mesh.name === 'Jacket' && (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            const previous = mesh.geometry, result = tailorCuffs(mesh as THREE.SkinnedMesh, 1.6);
            mesh.geometry = result.geometry;
            previous.dispose();
            report.cuffs.push(...result.report);
        }
    }
    // Synchronise shared material references before disposing replaced materials.
    for (const mesh of meshes) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const next = mats.map(m => replacements.get(m) || m);
        mesh.material = Array.isArray(mesh.material) ? next : next[0];
    }
    const usedTextures = new Set<THREE.Texture>();
    scene.traverse(node => { const mesh = node as THREE.Mesh; if (!mesh.isMesh)
        return; for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const value of Object.values(mat))
            if (value instanceof THREE.Texture)
                usedTextures.add(value); });
    const disposedTextures = new Set<THREE.Texture>();
    for (const old of replacements.keys()) {
        for (const value of Object.values(old))
            if (value instanceof THREE.Texture && !usedTextures.has(value) && !disposedTextures.has(value)) {
                value.dispose();
                disposedTextures.add(value);
            }
        old.dispose();
    }
    return { replacements, report };
}
