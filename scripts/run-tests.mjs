import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST_TEST_DIRECTORY = path.resolve("./dist-test");
const TEST_FILE_SUFFIX = ".test.js";

async function collectTestFiles(directoryPath) {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    const nestedPaths = await Promise.all(
        directoryEntries.map(async (directoryEntry) => {
            const entryPath = path.join(directoryPath, directoryEntry.name);

            if (directoryEntry.isDirectory()) {
                return collectTestFiles(entryPath);
            }

            if (directoryEntry.isFile() && directoryEntry.name.endsWith(TEST_FILE_SUFFIX)) {
                return [entryPath];
            }

            return [];
        }),
    );

    return nestedPaths.flat().sort();
}

const testFiles = await collectTestFiles(DIST_TEST_DIRECTORY);

if (testFiles.length === 0) {
    throw new Error("No bundled test files were found in ./dist-test");
}

console.log(`Running ${testFiles.length} test file(s)...`);

for (const testFile of testFiles) {
    const relativeTestPath = path.relative(DIST_TEST_DIRECTORY, testFile);

    try {
        await import(pathToFileURL(testFile).href);
        console.log(`PASS ${relativeTestPath}`);
    } catch (error) {
        console.error(`FAIL ${relativeTestPath}`);
        throw error;
    }
}

console.log(`Completed ${testFiles.length} test file(s) successfully.`);
