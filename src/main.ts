import { bootstrapApplication } from "./app-runtime";
import { RadiolarianNprProgramModule } from "./renderers/npr/programs/radiolarian";
import { RadiolarianLdzSceneModule } from "./renderers/webgpu/scenes/radiolarian";

// ======= Configuration =======
const widthCm = RadiolarianNprProgramModule.WIDTH_CM;
const heightCm = RadiolarianNprProgramModule.HEIGHT_CM;
const dpi = 60;
const maxDebugSize = 1024;
const gpuSeed = RadiolarianLdzSceneModule.GPU_SEED;
const nprSeed = RadiolarianNprProgramModule.NPR_SEED;
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
