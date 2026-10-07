export type RuntimeInput = {
  name: string;
  sizeBytes: number;
  path?: string;
  file?: File;
};

export type RuntimeProgress = {
  percent: number;
  fps?: string;
  speed?: number;
  currentSeconds?: number;
  durationSeconds?: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
  outputMegabytes?: number;
};

export type RuntimeResult = {
  outputBytes: number;
  elapsedSeconds: number;
  durationSeconds: number | null;
  speed: number | null;
  previewUrl: string;
  outputPath?: string;
  fileName: string;
  blob?: Blob;
};
