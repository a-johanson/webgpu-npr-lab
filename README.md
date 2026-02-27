# NPR based on WebGPU

This project is a playground for experimenting with non-photorealistic rendering (NPR) techniques in the browser, using WebGPU and custom WGSL shaders. You can view a static version of the playground [on GitHub Pages](https://a-johanson.github.io/npr-webgl-js/).

## Getting Started

1. Execute `npm run dev` to start the dev server.
2. Open your web browser and navigate to `http://localhost:8000`.
3. The main interface will load from `public/index.html` and show two canvases. The first one displays luminance/ surface direction/ depth (click to cycle) from the WebGPU pass. The second canvas uses a `2d` context and outputs the NPR experiment based on the luminance, direction, and depth data.
4. To customize the WGSL fragment shader, add a new shader to `src/shaders/fragment/` and import it in `renderers/webgl-renderer.js`.
5. To customize the NPR rendering program, add a new program to `src/npr/programs/` and import it in `renderers/npr-renderer.js`.
