import { Logger } from "../../utils/log";
import { promises as fsPromises, existsSync } from "fs";
import { resolve, join } from "path";
import { cyan, gray } from "chalk";
import * as buildUtils from "./user-utils";
import { InertConfig } from "./types";
import { resolveOutDir, resolveSourceDir } from "./utils/dirs";
import { Ora } from "ora";
import traverse from "./utils/traverse";
import { getFileInfo } from "./utils/file";

export interface BuildOptions {
  logging?: boolean;
  verbose?: boolean;
  spinner?: Ora;
}

/**
 * Build a project
 */
export default async function build(options: BuildOptions) {
  // Create a logger. The logger allows us to disable logging.
  const log = new Logger(options.logging, options.verbose ?? true);

  // Constants
  const project_dir = resolve(process.cwd());

  // Make sure an inert configuration file exists.
  if (!(await existsSync(join(project_dir, "inert.config.js")))) {
    options.spinner?.stop();
    log.error(
      "The current working directory does not appear to be a valid inert project."
    );
    log.error(`You can create a new project using the following command:`);
    log.error(`${gray("$")} inert ${cyan(`init ${project_dir}`)}`);
    options.spinner?.start();
    return false;
  }

  // Load the configuration file
  (global as any).inert = buildUtils; // Allthough this is generally considered bad practice, I think it works very well for this purpose.
  const config: InertConfig = require(join(project_dir, "inert.config.js"));

  // Make sure each source directory exists
  if (
    Object.keys(config.build.sourceDirs)
      .map((dir) =>
        existsSync(join(project_dir, resolveSourceDir(config, dir)))
      )
      .some((v) => v === false)
  ) {
    options.spinner?.stop();
    log.error(`Missing some source directories. Make sure every directory defined in 'config.build.sourceDirs' exists`);
    options.spinner?.start();
    return false;
  }

  // Set up output directory
  const out_dir = join(project_dir, resolveOutDir(config, ':output:'));
  options.spinner?.stop();
  if (existsSync(out_dir)) {
    log.verb('Output directory already exists');
  } else {
    log.verb(`Creating output directory: ${out_dir}`);
    await fsPromises.mkdir(out_dir);
  }
  // Create subdirs
  for (let outdir in config.build.outDirs) {
    await fsPromises.mkdir(join(project_dir, resolveOutDir(config, config.build.outDirs[outdir])), { recursive: true });
  }
  options.spinner?.start();

  // Build folders first, the build root. This makes sure that all optimized assets are
  // already available when the root is built
  const folders = config.build.folders;

  for (let folder of folders) {
    const path = join(project_dir, resolveSourceDir(config, folder.folder));
    options.spinner?.stop();
    log.verb(`Building ${cyan(path)}`);
    options.spinner?.start();

    const files = (await traverse(path, false, folder.build.traverseLevel === 'rescursive' ? true : false)) as string[];
    // Iterate over all files
    for (const file of files) {
      // Run the build pipeline
      let prev_res: any = undefined;
      for (const pipe of folder.build.filePipeline) {
        // Make sure `pipe` is a function; not everyone uses typescript
        if (typeof pipe !== 'function') {
          options.spinner?.stop();
          log.warn('Pipeline component is not a function. Skipping. Please make sure all elements in the filePipeline are functions.');
          options.spinner?.start();
          continue;
        }
        prev_res = pipe(config, getFileInfo(file), prev_res);
      }
    }
  }

  return true;
}