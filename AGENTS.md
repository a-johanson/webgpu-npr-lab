# Non-photorealistic rendering (NPR) based on WebGPU

This repository is a browser-based NPR lab for rendering static generative art images (no animations). It uses a CPU -> WebGPU -> CPU pipeline: scene modules typically build scene-specific CPU data first, upload it to GPU buffers, render tiled LDZ data (luminance, direction, and depth) plus optional color data on the GPU, and then return the frame payload to CPU-side NPR code for the final 2D canvas render. The final stage stays on the CPU because many NPR effects here are non-local and benefit from whole-image algorithms such as streamline tracing, stochastic stippling, and outline extraction.

## Structural overview

Use this section to orient before opening files. Prefer the smallest relevant slice of the tree instead of reading every same-named variant.

```text
src/
	main.ts                         selects the active scene/program pair and runtime constants
	app-runtime.ts                  bootstraps DOM, state, renderer wiring, and the initial render
	state-manager.ts                generic keyed state container with async subscriptions
	npr/                            reusable CPU-side NPR algorithms and color utilities
	renderers/
		frame-renderer.ts             shared FrameData contract between GPU and NPR stages
		webgpu-renderer.ts            tiled WebGPU orchestration and debug-canvas integration
		npr-renderer.ts               2D canvas orchestration for the active NPR program
		webgpu/
			ldz-pass.ts                 core GPU pipeline, uniforms, textures, and readback
			debug-presenter.ts          debug texture composition and presentation for debugCanvas
			ldz-scene-module.ts         scene interface and LDZ/color output contract
			scenes/                     scene-specific WGSL, CPU scene data, and GPU resource setup
		npr/
			npr-program-module.ts       NPR program interface
			programs/                   program-specific 2D rendering from LDZ data
	types/
		app-state.ts                  shared application state and dimension types
		xor4096.d.ts                  local typing for the seeded PRNG package
	vendor/esm-seedrandom/          vendored PRNG implementation used via xor4096
public/
	index.html                      UI shell, control IDs, debugCanvas, and outputCanvas
	style.css                       page styling
	js/main.js                      generated bundle; edit src/main.ts instead
scripts/                          scripts for Git pre-commit hook
```

The runtime flow is:

* `src/main.ts` selects one `LdzSceneModule` and one `NprProgramModule`.
* `src/app-runtime.ts` creates `StateManager<AppState>`, binds DOM controls from `public/index.html`, then instantiates `WebGpuRenderer` and `NprRenderer`.
* The selected `LdzSceneModule` typically computes scene-specific CPU data first, and `WebGpuLdzPass` uploads that data into GPU resources before rendering.
* `WebGpuRenderer` renders tiled LDZ output, optionally with scene color data, and exposes `FrameData`.
* `NprRenderer` reads `FrameData` and invokes the selected CPU `NprProgramModule` to paint the final 2D canvas; this stage stays on the CPU because the NPR effects used here are often non-local.

### Fast task routing

Use these entry points to avoid broad file reads:

* Change the active scene/program pair or default DPI/seed constants: start with `src/main.ts`.
* Change UI controls or render-trigger behavior: read `public/index.html`, then `src/app-runtime.ts`; read `src/types/app-state.ts` only if the state shape changes.
* Change app-wide state/subscription behavior: read `src/state-manager.ts` and `src/app-runtime.ts`.
* Change the shared frame payload, tiling, readback, or debug visualization: read `src/renderers/frame-renderer.ts`, `src/renderers/webgpu-renderer.ts`, `src/renderers/webgpu/ldz-pass.ts`, and `src/renderers/webgpu/debug-presenter.ts`.
* Change scene geometry, WGSL, or GPU resource setup: read `src/renderers/webgpu/ldz-scene-module.ts`, then the closest file in `src/renderers/webgpu/scenes/`.
* Change NPR appearance on the 2D canvas: read `src/renderers/npr/npr-program-module.ts`, then the closest file in `src/renderers/npr/programs/`, then only the helper files it imports from `src/npr/`.
* Change flow hatching: start with `src/npr/streamlines.ts`; current callers are the diatom and radiolarian NPR programs.
* Change stippling: start with `src/npr/stippling.ts`; current callers are the crystal and shell NPR programs.
* Change outline extraction or line cleanup: start with `src/npr/outlines.ts` and `src/npr/polyline.ts`.
* Change color interpolation or gradient behavior: start with `src/npr/color.ts`; radiolarian background color is generated in `src/renderers/webgpu/scenes/radiolarian.ts`.
* Change PRNG typing or vendor behavior: read `src/types/xor4096.d.ts` and `src/vendor/esm-seedrandom/`; most callers only need `prng_xor4096`.
* Change tooling, build, or formatting behavior: read `package.json`, `biome.json`, `tsconfig.json`, and `scripts/`.

Practical reading rules:

* Do not read every scene or every NPR program by default. Start with `src/main.ts` to find the active pair, then open only the matching implementation and its interface.
* When adding a new scene, read `src/renderers/webgpu/ldz-scene-module.ts` and one closest existing scene, not all four scenes.
* When adding a new NPR program, read `src/renderers/npr/npr-program-module.ts` and one closest existing program, then only the algorithm helpers it calls.
* Same-stem names (`crystal`, `diatom`, `radiolarian`, `shell`) indicate paired GPU and NPR modules. Read both only when a change crosses the GPU/CPU boundary.
* Treat `public/js/main.js` as generated output.
* Treat `src/vendor/esm-seedrandom/` as vendored code; avoid editing it unless the task is specifically about PRNG behavior or packaging.

### Keep this overview current

If a change affects structure, ownership, or high-level data flow, update this overview in the same patch.

* Update this section whenever you add, delete, rename, or move files or directories in `src/`, `public/`, or `scripts/`.
* Update it whenever responsibilities move between files, even if the paths stay the same.
* Update the runtime-flow bullets and fast-routing bullets when new render stages, contracts, or entry points are introduced.
* Keep the overview compact and decision-oriented. Prefer "start here for X" guidance over exhaustive per-file summaries.
* If a design note proposes structural change, call out which bullets in this overview will become stale and ensure they are updated before the task is complete.

## General guardrails and style

* Organize the application logic in TypeScript in `src/`.
* Use modern ECMAScript patterns and TypeScript-specific type utilities (target ES2024 with ESNext module structure, avoid legacy TS).
* Prefer object-oriented design whenever it makes sense to combine data and logic into classes.
* Always generate TSDoc comments in accordance with the Google TypeScript Style Guide.
* Use American English spelling.
* After you apply edits, run `npm run lint` to check for type errors and to apply linting & formatting.

## Collaboration and design workflow

* Before implementing substantial or potentially architectural changes, provide a short design note and wait for user approval.
* Treat a change as substantial when it introduces new abstractions, changes responsibilities, or has meaningful design uncertainty (not merely because multiple files are touched).
* If a change modifies project structure, file ownership, or render-stage data flow, update the structural overview in this file as part of the same change.
* Keep design notes concise and include:
	* problem framing and constraints,
	* plausible approaches (when applicable),
	* recommended approach with tradeoffs,
	* proposed responsibilities and data flow.

## Architecture guardrails

* Favor high cohesion and low coupling.
* Prefer composition and clear interfaces over large, multi-purpose classes.
* Keep orchestration thin and place core logic in focused components.
* Use established design patterns when they provide clear value; avoid pattern-driven overengineering.

## Pre-implementation check

Before coding, explicitly confirm to yourself:
* boundaries and dependencies are clear,
* interfaces are minimal and testable,
* the chosen design is the simplest approach that satisfies the requirements,
* you do not introduce redundant logic and types but re-use existing logic and types where appropriate.
