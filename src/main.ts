import { bootstrapApplication } from "./app-runtime";
import { DiatomNprProgramModule } from "./renderers/npr/programs/diatom";
import { RadiolarianLdzSceneModule } from "./renderers/webgpu/scenes/radiolarian";

// ======= Configuration =======
const widthCm = 60;
const heightCm = 60;
const dpi = 65;
const maxDebugSize = 1024;
const gpuSeed = 0;
const nprSeed = "52769ff2367023";
// =============================

const ldzSceneModule = new RadiolarianLdzSceneModule();
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
