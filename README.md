# Non-photorealistic rendering (NPR) based on WebGPU

This project is a browser-based NPR lab for rendering static generative art images. It uses a CPU -> WebGPU -> CPU pipeline: scene modules typically build scene-specific CPU data first, upload it to GPU buffers, render tiled LDZ data (luminance, direction, and depth) plus optional color data on the GPU, and then return the frame payload to CPU-side NPR code for a final 2D canvas render. The final stage stays on the CPU because many NPR effects are non-local.

You can view a static version of the lab [on GitHub Pages](https://a-johanson.github.io/webgpu-npr-lab/).

## Getting Started

To run the project locally, you need Node.js, npm, and a browser with WebGPU support.

1. Run `npm install`.
2. Run `npm run dev` to start the local development server.
3. Open your browser and navigate to `http://localhost:8000`.
4. The interface from `public/index.html` shows two canvases. The debug canvas displays luminance, surface direction, or depth from the WebGPU pass; click it to cycle modes. The output canvas shows the final CPU-side NPR render derived from that frame data.

## Development

* `npm run build` bundles the app into `public/js/main.js`.
* `npm run check` runs the TypeScript and Biome checks without rewriting files.
* `npm run lint` runs the TypeScript checks and applies Biome formatting and lint fixes.
* `npm run install-hook` installs the Git pre-commit hook.

## Customization

* Add a new `LdzSceneModule` under `src/renderers/webgpu/scenes/`.
* Add a new `NprProgramModule` under `src/renderers/npr/programs/`.
* Select the active scene/program pair in `src/main.ts`.
