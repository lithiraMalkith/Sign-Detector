import * as T from 'three';
export const HUMAN_SKIN = '#d9afa4';
// Recolour only light, warm skin texels. Dark brows/lashes, saturated lips,
// and neutral white details retain their original diffuse colours.
export function warmPinkSkin<M extends T.MeshPhongMaterial>(material: M): M {
    if (!material.map) {
        material.color.set(HUMAN_SKIN);
        return material;
    }
    material.onBeforeCompile = shader => {
        shader.uniforms.humanSkinColour = { value: new T.Color(HUMAN_SKIN) };
        shader.fragmentShader = 'uniform vec3 humanSkinColour;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
   vec3 skinSample = diffuseColor.rgb;
   float skinRed = max(skinSample.r, 0.0001);
   float greenRatio = skinSample.g / skinRed;
   float blueRatio = skinSample.b / skinRed;
   float skinMask = smoothstep(0.16, 0.40, skinRed)
     * smoothstep(0.34, 0.56, greenRatio)
     * (1.0 - smoothstep(0.91, 0.99, blueRatio));
   diffuseColor.rgb = mix(skinSample, humanSkinColour, skinMask * 0.85);
  `);
    };
    material.customProgramCacheKey = () => 'human-skin-rose-v1';
    material.needsUpdate = true;
    return material;
}
export function isBodySkinMaterial(material: T.MeshPhongMaterial) {
    const image = material.map?.image;
    const src = image && typeof image === 'object' && 'src' in image && typeof image.src === 'string' ? image.src : '';
    return /Body_Diff/i.test(src) || /^(Body|02 - Default)$/i.test(material.name);
}
