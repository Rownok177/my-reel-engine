import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

// Use Webpack instead of Rspack to avoid Rspack's filesystem cache limitations
Config.setRspack(false);

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

Config.overrideBundlerConfig((currentConfig) => {
  return enableTailwind(currentConfig);
});