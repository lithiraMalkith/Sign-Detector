# Avatar surface update and recovery

The existing QuickMagic avatar loader now applies the reviewed surface treatment after its import fixes. Source FBX files, textures, bone transforms, motion clips, sign matching, backend requests, emotion timing and camera framing are unchanged.

## Treatment

- Both avatars: 4x hand triangle subdivision with conservative rounding, fitted nail surfaces, restored original facial detail with the faulty auxiliary face material maps omitted, and a warm pink skin undertone.
- Girl: three small thumb openings repaired; sleeve cuffs shortened by 1.6 cm with slightly wider openings and skin lining beneath them.
- Boy: original cuffs retained because these mesh skeletons do not contain the corresponding forearm bones.

Nails inherit interpolated finger skin weights. Surface processing happens once per model load, not on every animation frame. New meshes use the same skeleton and participate in model disposal. This does not repair incorrect captured finger angles or provide cloth collision simulation. Extreme poses can still intersect. Shader-based skin colouring is for live rendering; generic GLB exporters do not serialize onBeforeCompile shaders.

## Quick disable

Set `NEXT_PUBLIC_AVATAR_SURFACE_ENHANCEMENTS=0` in the deployment/build environment, then **rebuild and redeploy**. Locally, set it in `.env.local` and restart the development server. This restores the previous loader path. The variable is public and is frozen into client code at build time; changing a server runtime variable alone does not change an existing browser bundle.

A specific loader caller can also pass `surfaceEnhancements: false` in `LoadOptions`.

## Git recovery

The pre-change main commit is `48ab8cb3f4f1e0a58045877024f76392459c9d85`.
The annotated rollback tag is `backup/avatar-before-surface-update-2026-10-20`.

To inspect the exact previous version without discarding current work, first commit or stash any local edits, then:

```sh
git fetch origin --tags
git switch -c recovery/pre-avatar-surface backup/avatar-before-surface-update-2026-10-20
```

To undo the update on main while retaining later history, use `git revert` on the avatar-update commit listed in the handoff, resolve any conflicts, test, then push. Avoid force-pushing or resetting shared main.

The pre-change tracked working tree was clean. The untracked `SignSpeak_Performance_Report.pptx` was intentionally left out of this update. A ZIP of the pre-change tracked tree was saved outside the repository as an additional local backup.

## Validation

Run `npm run test:avatar`, `npx tsc --noEmit`, and `npm run build`. The avatar test loads both actual FBX assets, validates fitted nails, topology and skin weights, preserves the original geometry buffers/bones/clips/morph positions, and samples the bundled animations with finite camera bounds. The separate lab also checked six sign clips; these tests do not establish linguistic sign accuracy or guarantee absence of all clothing collisions.
