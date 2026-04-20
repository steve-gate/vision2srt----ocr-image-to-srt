import Dexie, { type Table } from 'dexie';

export interface BoundingBox {
  box_2d: [number, number, number, number];
  label: string;
}

export interface StoredSubtitleItem {
  id: string;
  projectId: string; // Foreign key
  originalFileBlob: Blob;
  fileName: string;
  fileType: string;
  processedFileBlob?: Blob;
  isProcessed: boolean;
  text: string;
  duration: number;
  startTime?: number;
  endTime?: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMessage?: string;
  confidence?: number;
  boundingBoxes?: BoundingBox[];
  order: number;
}

export interface ProjectSettings {
  id: string; // Acts as projectId
  name: string;
  baseDuration: number;
  useFilenameTimestamps: boolean;
  isAutoClean: boolean;
  isDeepScan: boolean;
  minConfidence: number;
  lastUpdated: number;
  itemCount: number;
}

export class Vision2SRTDatabase extends Dexie {
  subtitles!: Table<StoredSubtitleItem>;
  projects!: Table<ProjectSettings>;

  constructor() {
    super('Vision2SRTDB');
    this.version(1).stores({
      subtitles: 'id, projectId, order, status',
      projects: 'id, lastUpdated'
    });
  }
}

export const db = new Vision2SRTDatabase();
