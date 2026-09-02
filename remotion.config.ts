import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setEntryPoint("src/index.ts");
Config.setRspack(false);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

Config.overrideBundlerConfig((currentConfig) => {
  return enableTailwind(currentConfig);
});