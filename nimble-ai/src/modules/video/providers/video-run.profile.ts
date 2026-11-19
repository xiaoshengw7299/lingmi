import * as fs from 'fs';
import * as path from 'path';

interface VideoRunProfile {
  generateResolution?: string;
  enhance?: Record<string, string>;
}

let loaded = false;
let profiles: Record<string, VideoRunProfile> = {};

function readProfiles(): Record<string, VideoRunProfile> {
  if (loaded) return profiles;
  loaded = true;
  const file = path.join(process.cwd(), 'config', 'video.local.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, VideoRunProfile>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) profiles = parsed;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!missing) throw new Error(`config/video.local.json 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  return profiles;
}

export function videoRunProfile(modelId: string, userResolution?: string): {
  submitResolution?: string;
  enhanceTo?: string;
  hiddenResolution?: string;
} {
  const profile = readProfiles()[modelId];
  const enhanceTo = userResolution ? profile?.enhance?.[userResolution] : undefined;
  const submitResolution = enhanceTo && profile?.generateResolution ? profile.generateResolution : userResolution;
  return {
    submitResolution,
    enhanceTo,
    hiddenResolution: enhanceTo ? profile?.generateResolution : undefined,
  };
}

export function videoRunProbeResolutions(modelId: string): string[] {
  const resolution = readProfiles()[modelId]?.generateResolution;
  return resolution ? [resolution] : [];
}
