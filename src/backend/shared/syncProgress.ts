export type SyncOuterLoopProgress = {
  completed: number;
  total: number;
  failed?: number;
  currentItem?: string;
  unitLabel: string;
};

export type SyncProgressReporter = (progress: SyncOuterLoopProgress) => void | Promise<void>;
