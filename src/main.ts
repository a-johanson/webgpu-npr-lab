import { bootstrapApplication } from "./app-runtime";
import { RadiolarianNprProgramModule } from "./renderers/npr/programs/radiolarian";
import { RadiolarianLdzSceneModule } from "./renderers/webgpu/scenes/radiolarian";

// ======= Configuration =======
const widthCm = 50;
const heightCm = 60;
const dpi = 60;
const maxDebugSize = 1024;
const gpuSeed = 0;
const nprSeed = "52769ff2367023";
// =============================

const ldzSceneModule = new RadiolarianLdzSceneModule();
const nprProgramModule = new RadiolarianNprProgramModule();

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
