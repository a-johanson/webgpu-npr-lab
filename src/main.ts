import { bootstrapApplication } from "./app-runtime";
import { DiatomNprProgramModule } from "./renderers/npr/programs/diatom";
import { DiatomLdzSceneModule } from "./renderers/webgpu/scenes/diatom";

// ======= Configuration =======
const widthCm = 60;
const heightCm = 60;
const dpi = 65;
const maxDebugSize = 1024;
const gpuSeed = 0;
const nprSeed = "52769ff2367023";
// =============================

const ldzSceneModule = new DiatomLdzSceneModule();
const nprProgramModule = new DiatomNprProgramModule();

bootstrapApplication({
    widthCm,
    heightCm,
    dpi,
    maxDebugSize,
    gpuSeed,
    nprSeed,
    ldzSceneModule,
    nprProgramModule,
});
