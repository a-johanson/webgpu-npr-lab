# NPR based on WebGPU data

This project implements a hybrid WebGPU-CPU pipeline for experimenting with non-photorealistic rendering (NPR) in the browser. The GPU stage leverages ray marching and signed distance fields to efficiently generate luminance, direction, and depth (LDZ) data. This data is then passed to a CPU-based NPR stage, enabling the use of non-local techniques.

You can view a static version of the lab [on GitHub Pages](https://a-johanson.github.io/webgpu-npr-lab/).

## Getting Started

1. Execute `npm install` followed by `npm run dev` to start the dev server.
2. Open your web browser and navigate to `http://localhost:8000`.
3. The main interface will load from `public/index.html` and show two canvases. The first one displays luminance/ surface direction/ depth (click to cycle) from the WebGPU pass. The second canvas uses a `2d` context and outputs the NPR experiment based on the LDZ data.
4. To customize the WebGPU stage, add a new `LdzSceneModule` to `src/renderers/webgpu/scenes/`.
5. To customize the NPR rendering program, add a new `NprProgramModule` to `src/renderers/npr/programs/`.
6. Wire WebGPU scene and NPR program together in `src/main.ts` to see the results.
