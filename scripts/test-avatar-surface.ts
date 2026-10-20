import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { enhanceAvatarSurface } from '../components/three/surface/enhanceAvatarSurface';
import { topology } from '../components/three/surface/topology';
// Texture pixels require a browser. Geometry/rig tests use harmless placeholders.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
Object.defineProperty(globalThis, 'window', { value: { URL }, configurable: true });
const results = [];
for (const [avatar, file] of [['girl', 'public/models/A/A_GirlFBX  T.fbx'], ['boy', 'public/models/B/VideoEditor_202_BoyFBX.fbx']] as const) {
    const bytes = fs.readFileSync(file), scene = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    scene.scale.setScalar(.01);
    scene.updateMatrixWorld(true);
    const originalBones: THREE.Bone[] = [];
    scene.traverse(n => { if ((n as THREE.Bone).isBone)
        originalBones.push(n as THREE.Bone); const m = n as THREE.Mesh; if (m.isMesh) {
        m.geometry.deleteAttribute('color');
        if (!m.geometry.index)
            m.geometry = mergeVertices(m.geometry, 1e-4);
    } });
    const originalPose = originalBones.map(b => [b.position.toArray(), b.quaternion.toArray(), b.scale.toArray()]);
    const hand = scene.getObjectByName('Gloves') as THREE.SkinnedMesh, head = scene.getObjectByName(avatar === 'girl' ? 'Head' : 'face') as THREE.Mesh;
    const originalHand = hand.geometry, originalHandJSON = JSON.stringify(originalHand.toJSON()), headPositions = Array.from(head.geometry.attributes.position.array), morphs = JSON.stringify(head.geometry.morphAttributes);
    const originalClips = scene.animations.map(c => JSON.stringify(c.toJSON()));
    const { report } = enhanceAvatarSurface(scene, avatar);
    assert.equal(JSON.stringify(originalHand.toJSON()), originalHandJSON, 'Source hand buffers changed');
    assert.deepEqual(Array.from(head.geometry.attributes.position.array), headPositions, 'Face shape changed');
    assert.equal(JSON.stringify(head.geometry.morphAttributes), morphs, 'Morph targets changed');
    assert.deepEqual(originalBones.map(b => [b.position.toArray(), b.quaternion.toArray(), b.scale.toArray()]), originalPose, 'Skeleton changed');
    assert.deepEqual(scene.animations.map(c => JSON.stringify(c.toJSON())), originalClips, 'Animation changed');
    assert.equal(report.hands[0].repair.patchedHoles, avatar === 'girl' ? 3 : 0);
    assert.equal(report.nails.filter(n => n.added).length, 10);
    assert.equal(report.cuffs.length, avatar === 'girl' ? 2 : 0);
    assert.equal(topology(hand.geometry).nonManifold, 0);
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse(n => { if ((n as THREE.SkinnedMesh).isSkinnedMesh)
        meshes.push(n as THREE.SkinnedMesh); });
    for (const mesh of meshes) {
        const g = mesh.geometry;
        for (const attr of Object.values(g.attributes))
            for (const value of attr.array)
                assert(Number.isFinite(value));
        for (let i = 0; i < g.attributes.position.count; i++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += g.attributes.skinWeight.getComponent(i, k);
                assert(g.attributes.skinIndex.getComponent(i, k) < mesh.skeleton.bones.length);
            }
            assert(Math.abs(sum - 1) < 1e-4);
        }
    }
    const clips = scene.animations.filter(c => c.duration > .1);
    assert(clips.length > 0);
    let samples = 0;
    for (const clip of clips) {
        const mixer = new THREE.AnimationMixer(scene);
        mixer.clipAction(clip).play();
        for (const fraction of [0, .25, .5, .75, .99]) {
            mixer.setTime(clip.duration * fraction);
            scene.updateMatrixWorld(true);
            for (const mesh of meshes) {
                mesh.skeleton.update();
                for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
                    const v = new THREE.Vector3();
                    mesh.getVertexPosition(i, v);
                    assert(v.toArray().every(Number.isFinite));
                }
            }
            const bounds = new THREE.Box3().setFromObject(scene);
            assert(bounds.min.toArray().every(Number.isFinite));
            assert(bounds.max.toArray().every(Number.isFinite));
            assert(bounds.getSize(new THREE.Vector3()).length() < 10, 'Framing bounds unexpectedly oversized');
            samples++;
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
    }
    results.push({ avatar, patchedHoles: report.hands[0].repair.patchedHoles, nails: report.nails.filter(n => n.added).length, cuffs: report.cuffs.length, animatedSamples: samples });
}
console.log(JSON.stringify({ passed: true, results }, null, 2));
