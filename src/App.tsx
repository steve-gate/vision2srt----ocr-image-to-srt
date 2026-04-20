import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, 
  Trash2, 
  Download, 
  Play, 
  Clock, 
  FileText, 
  X, 
  Loader2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  AlertCircle,
  RefreshCcw,
  Save,
  RotateCcw,
  Library,
  PlusCircle,
  History,
  MoreVertical,
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractTextFromImage, BoundingBox } from './services/ocrService';
import { processImageToBW } from './utils/imageProcessor';
import { db, type StoredSubtitleItem, type ProjectSettings } from './db';
import { useLiveQuery } from 'dexie-react-hooks';

const DEFAULT_PROJECT_ID = 'default-project';

interface SubtitleItem {
  id: string;
  file: File; // This represents the active file (original or processed)
  previewUrl: string; // The active preview URL
  originalFile: File;
  originalPreviewUrl: string;
  processedFile?: File;
  processedPreviewUrl?: string;
  isProcessed: boolean;
  text: string;
  duration: number; // in seconds
  startTime?: number; // absolute start time in seconds
  endTime?: number;   // absolute end time in seconds
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMessage?: string;
  confidence?: number;
  boundingBoxes?: BoundingBox[];
}

function BoundingBoxOverlay({ boxes }: { boxes: BoundingBox[] }) {
  return (
    <div className="absolute inset-0 pointer-events-none group-hover:opacity-100 transition-opacity">
      {boxes.map((box, i) => {
        const [ymin, xmin, ymax, xmax] = box.box_2d;
        return (
          <div
            key={i}
            className="absolute border border-indigo-400 bg-indigo-400/5 rounded-sm"
            style={{
              top: `${ymin / 10}%`,
              left: `${xmin / 10}%`,
              width: `${(xmax - xmin) / 10}%`,
              height: `${(ymax - ymin) / 10}%`,
            }}
          >
            {box.label && (
              <div className="absolute -top-3 left-0 bg-indigo-600 text-white text-[7px] px-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity flex items-center h-2.5">
                {box.label.length > 20 ? box.label.substring(0, 20) + '...' : box.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [baseDuration, setBaseDuration] = useState(5);
  const [useFilenameTimestamps, setUseFilenameTimestamps] = useState(true);
  const [isAutoClean, setIsAutoClean] = useState(false);
  const [isDeepScan, setIsDeepScan] = useState(false);
  const [minConfidence, setMinConfidence] = useState(70);
  const [filterMode, setFilterMode] = useState<'all' | 'needs-attention'>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRestored, setIsRestored] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(() => {
    return localStorage.getItem('lastActiveProjectId') || DEFAULT_PROJECT_ID;
  });
  const [showLibrary, setShowLibrary] = useState(false);
  const [projectName, setProjectName] = useState('Dự án mới');
  const [storageUsage, setStorageUsage] = useState<string>('0 KB');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy('lastUpdated').reverse().toArray());

  // Check storage usage
  const updateStorageEstimate = useCallback(async () => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      if (used > 1024 * 1024) {
        setStorageUsage((used / (1024 * 1024)).toFixed(1) + ' MB');
      } else {
        setStorageUsage((used / 1024).toFixed(0) + ' KB');
      }
    }
  }, []);

  useEffect(() => {
    updateStorageEstimate();
  }, [subtitles, projects, updateStorageEstimate]);

  // Restore Project on Change
  useEffect(() => {
    localStorage.setItem('lastActiveProjectId', currentProjectId);
    
    const restoreProject = async () => {
      setIsRestored(false);
      // Clear current UI state first to avoid flickering with old data
      setSubtitles([]);
      
      try {
        const storedProject = await db.projects.get(currentProjectId);
        if (storedProject) {
          setProjectName(storedProject.name);
          setBaseDuration(storedProject.baseDuration);
          setUseFilenameTimestamps(storedProject.useFilenameTimestamps);
          setIsAutoClean(storedProject.isAutoClean);
          setIsDeepScan(storedProject.isDeepScan);
          setMinConfidence(storedProject.minConfidence);
        } else {
          // New project defaults
          setProjectName('Dự án mới');
          setBaseDuration(5);
        }

        const storedSubtitles = await db.subtitles
          .where('projectId').equals(currentProjectId)
          .sortBy('order');

        // Revoke old URLs
        subtitles.forEach(s => {
          URL.revokeObjectURL(s.originalPreviewUrl);
          if (s.processedPreviewUrl) URL.revokeObjectURL(s.processedPreviewUrl);
        });

        if (storedSubtitles.length > 0) {
          const restoredItems: SubtitleItem[] = storedSubtitles.map(s => {
            const originalUrl = URL.createObjectURL(s.originalFileBlob);
            const processedUrl = s.processedFileBlob ? URL.createObjectURL(s.processedFileBlob) : undefined;
            
            return {
              id: s.id,
              originalFile: new File([s.originalFileBlob], s.fileName, { type: s.fileType }),
              originalPreviewUrl: originalUrl,
              processedFile: s.processedFileBlob ? new File([s.processedFileBlob], s.fileName, { type: 'image/png' }) : undefined,
              processedPreviewUrl: processedUrl,
              isProcessed: s.isProcessed,
              file: s.isProcessed && s.processedFileBlob 
                ? new File([s.processedFileBlob], s.fileName, { type: 'image/png' }) 
                : new File([s.originalFileBlob], s.fileName, { type: s.fileType }),
              previewUrl: s.isProcessed && processedUrl ? processedUrl : originalUrl,
              text: s.text,
              duration: s.duration,
              startTime: s.startTime,
              endTime: s.endTime,
              status: s.status,
              errorMessage: s.errorMessage,
              confidence: s.confidence,
              boundingBoxes: s.boundingBoxes
            };
          });
          setSubtitles(restoredItems);
        } else {
          setSubtitles([]);
        }
      } catch (error) {
        console.error('Failed to restore project:', error);
      } finally {
        setIsRestored(true);
      }
    };

    restoreProject();
  }, [currentProjectId]);

  // Auto-save Project Metadata
  useEffect(() => {
    // CRITICAL: Only save if we have finished restoring the state for THIS specific project ID
    if (!isRestored) return;
    
    db.projects.put({
      id: currentProjectId,
      name: projectName,
      baseDuration,
      useFilenameTimestamps,
      isAutoClean,
      isDeepScan,
      minConfidence,
      lastUpdated: Date.now(),
      itemCount: subtitles.length
    });
  }, [projectName, baseDuration, useFilenameTimestamps, isAutoClean, isDeepScan, minConfidence, subtitles.length, isRestored, currentProjectId]);

  // Auto-save Subtitles
  useEffect(() => {
    // CRITICAL: Only save if we have finished restoring the state for THIS specific project ID
    if (!isRestored) return;
    
    const saveItems = async () => {
      // For simplicity in this demo, we use a single key for sorting and clear subtitles for this project
      // In production, we'd use more surgical updates
      await db.subtitles.where('projectId').equals(currentProjectId).delete();
      
      const storageItems: StoredSubtitleItem[] = subtitles.map((s, index) => ({
        id: s.id,
        projectId: currentProjectId,
        originalFileBlob: s.originalFile,
        fileName: s.originalFile.name,
        fileType: s.originalFile.type,
        processedFileBlob: s.processedFile,
        isProcessed: s.isProcessed,
        text: s.text,
        duration: s.duration,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        errorMessage: s.errorMessage,
        confidence: s.confidence,
        boundingBoxes: s.boundingBoxes,
        order: index
      }));
      await db.subtitles.bulkAdd(storageItems);
    };

    saveItems();
  }, [subtitles, isRestored, currentProjectId]);

  const createNewProject = () => {
    const id = 'proj-' + Math.random().toString(36).substr(2, 9);
    setCurrentProjectId(id);
    setProjectName(`Dự án ${new Date().toLocaleDateString()}`);
    setSubtitles([]);
    setShowLibrary(false);
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa dự án này vĩnh viễn?')) return;
    await db.projects.delete(id);
    await db.subtitles.where('projectId').equals(id).delete();
    if (currentProjectId === id) {
      setCurrentProjectId(DEFAULT_PROJECT_ID);
    }
    await updateStorageEstimate();
  };

  const wipeAllData = async () => {
    const isConfirmed = confirm(
      'XÁC NHẬN XÓA TẬN GỐC:\n\n' +
      'Thao tác này sẽ xóa sạch toàn bộ dữ liệu trong IndexedDB của trình duyệt, bao gồm:\n' +
      '- Tất cả các dự án\n' +
      '- Toàn bộ hình ảnh đã tải lên\n' +
      '- Toàn bộ văn bản đã trích xuất\n\n' +
      'Bạn có chắc chắn muốn xóa không?'
    );

    if (!isConfirmed) return;
    
    try {
      // Revoke all current URLs to free memory
      subtitles.forEach(item => {
        URL.revokeObjectURL(item.originalPreviewUrl);
        if (item.processedPreviewUrl) URL.revokeObjectURL(item.processedPreviewUrl);
      });

      // Clear all tables
      await Promise.all([
        db.projects.clear(),
        db.subtitles.clear()
      ]);

      setSubtitles([]);
      setCurrentProjectId(DEFAULT_PROJECT_ID);
      setProjectName('Dự án mới');
      
      // Forces immediate UI update to show 0 if possible
      await updateStorageEstimate();

      alert('Đã xóa sạch toàn bộ dữ liệu khỏi IndexedDB thành công.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to wipe IndexedDB:', error);
      alert('Có lỗi xảy ra khi xóa dữ liệu.');
    }
  };

  const clearProject = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ quá trình TRONG DỰ ÁN NÀY không?')) return;
    
    subtitles.forEach(item => {
      URL.revokeObjectURL(item.originalPreviewUrl);
      if (item.processedPreviewUrl) URL.revokeObjectURL(item.processedPreviewUrl);
    });
    
    setSubtitles([]);
    await db.subtitles.where('projectId').equals(currentProjectId).delete();
    await updateStorageEstimate();
  };

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor(Math.round((seconds % 1) * 1000));
    
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  const parseFilename = (filename: string): { start: number; end: number } | null => {
    // Regex for H_MM_SS_MS__H_MM_SS_MS
    const regex = /^(\d+)_(\d{2})_(\d{2})_(\d{3})__(\d+)_(\d{2})_(\d{2})_(\d{3})/;
    const match = filename.match(regex);
    
    if (match) {
      const startH = parseInt(match[1]);
      const startM = parseInt(match[2]);
      const startS = parseInt(match[3]);
      const startMS = parseInt(match[4]);
      
      const endH = parseInt(match[5]);
      const endM = parseInt(match[6]);
      const endS = parseInt(match[7]);
      const endMS = parseInt(match[8]);
      
      const start = startH * 3600 + startM * 60 + startS + startMS / 1000;
      const end = endH * 3600 + endM * 60 + endS + endMS / 1000;
      
      return { start, end };
    }
    return null;
  };

  const generateSRT = () => {
    let currentTime = 0;
    let srtContent = '';

    const sortedSubtitles = useFilenameTimestamps 
      ? [...subtitles].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
      : subtitles;

    sortedSubtitles.forEach((item, index) => {
      let startSeconds, endSeconds;

      if (useFilenameTimestamps && item.startTime !== undefined && item.endTime !== undefined) {
        startSeconds = item.startTime;
        endSeconds = item.endTime;
      } else {
        startSeconds = currentTime;
        endSeconds = currentTime + item.duration;
        currentTime += item.duration;
      }

      const startTimeFormatted = formatTime(startSeconds);
      const endTimeFormatted = formatTime(endSeconds);
      
      srtContent += `${index + 1}\n`;
      srtContent += `${startTimeFormatted} --> ${endTimeFormatted}\n`;
      srtContent += `${item.text || '[No text extracted]'}\n\n`;
    });

    return srtContent;
  };

  const handleDownload = () => {
    const srtContent = generateSRT();
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files) return;
    
    const fileList = Array.from(files);
    const newItems: SubtitleItem[] = [];

    for (const file of fileList) {
      const timestamps = parseFilename(file.name);
      const originalPreviewUrl = URL.createObjectURL(file);
      
      let item: SubtitleItem = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        previewUrl: originalPreviewUrl,
        originalFile: file,
        originalPreviewUrl: originalPreviewUrl,
        isProcessed: false,
        text: '',
        duration: timestamps ? (timestamps.end - timestamps.start) : baseDuration,
        startTime: timestamps?.start,
        endTime: timestamps?.end,
        status: 'pending'
      };

      if (isAutoClean) {
        try {
          const { blob, url } = await processImageToBW(file);
          const processedFile = new File([blob], file.name, { type: 'image/png' });
          item = {
            ...item,
            file: processedFile,
            previewUrl: url,
            processedFile,
            processedPreviewUrl: url,
            isProcessed: true
          };
        } catch (error) {
          console.error('Auto clean failed for:', file.name, error);
        }
      }

      newItems.push(item);
    }

    setSubtitles(prev => [...prev, ...newItems]);
  }, [baseDuration, isAutoClean]);

  const toggleCleanItem = async (id: string) => {
    setSubtitles(prev => {
      const items = [...prev];
      const index = items.findIndex(s => s.id === id);
      if (index === -1) return prev;

      const item = items[index];
      
      if (item.isProcessed) {
        // Switch back to original
        items[index] = {
          ...item,
          isProcessed: false,
          file: item.originalFile,
          previewUrl: item.originalPreviewUrl
        };
      } else if (item.processedFile && item.processedPreviewUrl) {
        // Reuse existing processed file
        items[index] = {
          ...item,
          isProcessed: true,
          file: item.processedFile,
          previewUrl: item.processedPreviewUrl
        };
      } else {
        // Need to process for the first time
        // This is async, so we handle it outside or return a promise
        // For simplicity, I'll trigger it here
        processItemManually(id);
      }
      return items;
    });
  };

  const processItemManually = async (id: string) => {
    const item = subtitles.find(s => s.id === id);
    if (!item || item.processedFile) return;

    try {
      const { blob, url } = await processImageToBW(item.originalFile);
      const processedFile = new File([blob], item.originalFile.name, { type: 'image/png' });
      
      setSubtitles(prev => prev.map(s => s.id === id ? {
        ...s,
        file: processedFile,
        previewUrl: url,
        processedFile,
        processedPreviewUrl: url,
        isProcessed: true
      } : s));
    } catch (error) {
      console.error('Manual clean failed for:', item.originalFile.name, error);
    }
  };

  const removeSubtitle = (id: string) => {
    setSubtitles(prev => {
      const filtered = prev.filter(item => item.id !== id);
      const removed = prev.find(item => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.originalPreviewUrl);
        if (removed.processedPreviewUrl) URL.revokeObjectURL(removed.processedPreviewUrl);
      }
      return filtered;
    });
  };

  const updateText = (id: string, text: string) => {
    setSubtitles(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  };

  const updateDuration = (id: string, duration: number) => {
    setSubtitles(prev => prev.map(item => item.id === id ? { ...item, duration: Math.max(0.5, duration) } : item));
  };

  const processOCR = async (retryFailedOnly: boolean = false) => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    // Process pending items, and optionally error items
    const itemsToProcess = subtitles.filter(s => 
      retryFailedOnly 
        ? s.status === 'error' 
        : (s.status === 'pending' || s.status === 'error')
    );
    
    for (const item of itemsToProcess) {
      // Check if item still exists in the list (user might have removed it)
      setSubtitles(prev => {
        const currentItem = prev.find(s => s.id === item.id);
        if (!currentItem) return prev;
        return prev.map(s => s.id === item.id ? { ...s, status: 'processing', errorMessage: undefined } : s);
      });

      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
          reader.readAsDataURL(item.file);
        });

        const result = await extractTextFromImage(base64, item.file.type, isDeepScan);
        setSubtitles(prev => prev.map(s => s.id === item.id ? { 
          ...s, 
          text: result.text, 
          confidence: result.confidence,
          boundingBoxes: result.boundingBoxes,
          status: 'done', 
          errorMessage: undefined 
        } : s));
      } catch (error) {
        console.error(`OCR failed for ${item.file.name}:`, error);
        const msg = error instanceof Error ? error.message : 'Lỗi trích xuất văn bản';
        setSubtitles(prev => prev.map(s => s.id === item.id ? { ...s, status: 'error', errorMessage: msg } : s));
        // Continue to the next item instead of throwing
      }
    }
    
    setIsProcessing(false);
  };

  const retryItemOCR = async (id: string) => {
    const item = subtitles.find(s => s.id === id);
    if (!item) return;

    setSubtitles(prev => prev.map(s => s.id === id ? { ...s, status: 'processing', errorMessage: undefined } : s));

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
        reader.readAsDataURL(item.file);
      });

      const result = await extractTextFromImage(base64, item.file.type, isDeepScan);
      setSubtitles(prev => prev.map(s => s.id === id ? { 
        ...s, 
        text: result.text, 
        confidence: result.confidence,
        boundingBoxes: result.boundingBoxes,
        status: 'done', 
        errorMessage: undefined 
      } : s));
    } catch (error) {
      console.error(`OCR retry failed for ${item.file.name}:`, error);
      const msg = error instanceof Error ? error.message : 'Lỗi trích xuất văn bản';
      setSubtitles(prev => prev.map(s => s.id === id ? { ...s, status: 'error', errorMessage: msg } : s));
    }
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= subtitles.length) return;

    const newItems = [...subtitles];
    const temp = newItems[index];
    newItems[index] = newItems[newIndex];
    newItems[newIndex] = temp;
    setSubtitles(newItems);
  };

  const filteredSubtitles = subtitles.filter(item => {
    if (filterMode === 'all') return true;
    const isLowConfidence = item.confidence !== undefined && item.confidence < minConfidence;
    return item.status === 'error' || isLowConfidence;
  });

  return (
    <div className="min-h-screen bg-neutral-100 text-slate-900 font-sans flex overflow-hidden">
      {/* Project Library Sidebar */}
      <AnimatePresence>
        {showLibrary && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="w-80 bg-white border-r border-slate-200 z-50 flex flex-col shadow-2xl h-screen sticky top-0"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-black text-indigo-900 flex items-center gap-2">
                <Library size={24} className="text-indigo-600" />
                Thư viện
              </h2>
              <button 
                onClick={() => setShowLibrary(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4">
              <button 
                onClick={createNewProject}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
              >
                <PlusCircle size={20} />
                DỰ ÁN MỚI
              </button>
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-slate-400 uppercase mb-4 px-2">Gần đây</h3>
              {projects?.map(proj => (
                <div 
                  key={proj.id}
                  onClick={() => {
                    setCurrentProjectId(proj.id);
                    setShowLibrary(false);
                  }}
                  className={`group p-4 rounded-xl border cursor-pointer transition-all ${
                    currentProjectId === proj.id 
                    ? 'border-indigo-600 bg-indigo-50 shadow-sm' 
                    : 'border-slate-100 bg-slate-50 hover:border-indigo-200 hover:bg-white'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-sm font-bold truncate max-w-[160px] ${currentProjectId === proj.id ? 'text-indigo-900' : 'text-slate-700'}`}>
                      {proj.name}
                    </span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(proj.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <ImageIcon size={10} /> {proj.itemCount} ảnh
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {new Date(proj.lastUpdated).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 space-y-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dung lượng đã dùng</span>
                  <span className="text-[10px] font-black text-indigo-600">{storageUsage}</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full w-[15%]" />
                </div>
                <p className="mt-2 text-[9px] text-slate-400 leading-tight italic">
                  Dữ liệu được lưu an toàn trong <b>IndexedDB</b> của trình duyệt trên máy tính này.
                </p>
              </div>

              <button 
                onClick={wipeAllData}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-rose-100 bg-rose-50/50 text-rose-500 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-rose-100 hover:text-rose-600 transition-all font-sans"
              >
                <Trash2 size={12} />
                Xóa sạch IndexedDB trình duyệt
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="flex-grow min-h-screen overflow-y-auto relative py-4 md:py-8">
        {/* Loading Overlay */}
        {!isRestored && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-[60] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
              <p className="text-sm font-black text-indigo-900 uppercase tracking-widest">Đang tải dữ liệu...</p>
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <header className="mb-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowLibrary(true)}
                  className="p-3 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm"
                  title="Mở Thư viện"
                >
                  <Library size={24} />
                </button>
                <div>
                  <div className="flex items-center gap-2 group">
                    <input 
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="text-4xl font-black tracking-tight text-slate-900 bg-transparent border-b-2 border-transparent focus:border-indigo-500 focus:outline-none transition-all py-1"
                      placeholder="Tên dự án..."
                    />
                    <Edit2 size={20} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="mt-1 text-slate-500 font-bold flex items-center gap-2">
                    <History size={14} />
                    Cập nhật mới nhất: {new Date().toLocaleTimeString()}
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => setIsDeepScan(!isDeepScan)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    isDeepScan 
                    ? 'bg-purple-50 border-purple-200 text-purple-700 font-bold' 
                    : 'bg-white border-slate-200 text-slate-400 font-medium'
                  }`}
                >
                  <Play size={16} />
                  <span className="text-xs">Quét chuyên sâu</span>
                </button>

                <button 
                  onClick={() => setIsAutoClean(!isAutoClean)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    isAutoClean 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-bold' 
                    : 'bg-white border-slate-200 text-slate-400 font-medium'
                  }`}
                >
                  <ImageIcon size={16} />
                  <span className="text-xs">Tự động lọc nền</span>
                </button>

                <button 
                  onClick={() => setUseFilenameTimestamps(!useFilenameTimestamps)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    useFilenameTimestamps 
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' 
                    : 'bg-white border-slate-200 text-slate-400 font-medium'
                  }`}
                >
                  <FileText size={16} />
                  <span className="text-xs text-nowrap">TG từ tên file</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm grow md:grow-0">
                <AlertCircle size={16} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Độ tin cậy tối thiểu:</span>
                <input 
                  type="number" 
                  value={minConfidence} 
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="w-10 text-center font-black text-indigo-600 focus:outline-none bg-transparent"
                />
                <span className="text-[10px] font-black text-slate-400">%</span>
              </div>

              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm grow md:grow-0">
                <Clock size={16} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Thời lượng mặc định:</span>
                <input 
                  type="number" 
                  value={baseDuration} 
                  onChange={(e) => setBaseDuration(Number(e.target.value))}
                  className="w-12 text-center font-black text-indigo-600 focus:outline-none bg-transparent"
                />
                <span className="text-[10px] font-black text-slate-400">s</span>
              </div>
            </div>
          </header>

        {/* Upload Area */}
        <section 
          className="mb-8 p-12 bg-white border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors hover:border-indigo-400 group cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFilesSelected(e.dataTransfer.files);
          }}
        >
          <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full group-hover:scale-110 transition-transform">
            <Upload size={32} />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-700">Kéo và thả ảnh vào đây</p>
            <p className="text-sm text-slate-400 mt-1">Hỗ trợ JPG, PNG, WEBP</p>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            multiple 
            accept="image/*" 
            className="hidden" 
            onChange={(e) => onFilesSelected(e.target.files)}
          />
        </section>

        {/* List of Items */}
        {subtitles.length > 0 && (
          <div className="space-y-4 mb-24">
            <div className="flex flex-col md:flex-row md:items-center justify-between px-2 gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">
                  Phụ đề ({subtitles.length})
                </h2>
                <div className="flex bg-slate-200 p-0.5 rounded-lg text-[10px] font-bold">
                  <button 
                    onClick={() => setFilterMode('all')}
                    className={`px-3 py-1 rounded-md transition-all ${filterMode === 'all' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                  >
                    Tất cả
                  </button>
                  <button 
                    onClick={() => setFilterMode('needs-attention')}
                    className={`px-3 py-1 rounded-md transition-all ${filterMode === 'needs-attention' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500'}`}
                  >
                    Cần chú ý ({subtitles.filter(s => s.status === 'error' || (s.confidence !== undefined && s.confidence < minConfidence)).length})
                  </button>
                </div>
                <button 
                  onClick={clearProject}
                  className="flex items-center gap-1 px-2 py-1 text-rose-500 hover:bg-rose-50 rounded transition-colors text-[10px] font-black uppercase tracking-wider"
                  title="Xóa toàn bộ ảnh trong dự án này"
                >
                  <Trash2 size={12} />
                  Xóa tất cả
                </button>
              </div>
              
              <div className="flex gap-2">
                {subtitles.some(s => s.status === 'error') && (
                  <button 
                    onClick={() => processOCR(true)}
                    disabled={isProcessing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-all text-xs"
                  >
                    <RefreshCcw size={14} className={isProcessing ? 'animate-spin' : ''} />
                    THỬ LẠI CÁC MỤC LỖI
                  </button>
                )}
                <button 
                  onClick={() => processOCR(false)}
                  disabled={isProcessing || !subtitles.some(s => s.status === 'pending' || s.status === 'error')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all ${
                    isProcessing || !subtitles.some(s => s.status === 'pending' || s.status === 'error')
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white shadow-md hover:bg-indigo-700 active:transform active:scale-95'
                  }`}
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                  {subtitles.some(s => s.status === 'pending') ? 'TRÍCH XUẤT VĂN BẢN' : 'CHẠY LẠI TOÀN BỘ'}
                </button>
              </div>
            </div>

            <AnimatePresence mode="popLayout">
              {filteredSubtitles.map((item, index) => {
                const globalIndex = subtitles.findIndex(s => s.id === item.id);
                return (
                  <motion.div 
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`bg-white rounded-xl border ${
                      item.confidence !== undefined && item.confidence < minConfidence 
                      ? 'border-rose-300 ring-2 ring-rose-100 shadow-rose-50' 
                      : 'border-slate-200 shadow-sm'
                    } overflow-hidden flex flex-col md:flex-row transition-all`}
                  >
                    {/* Image Preview */}
                    <div className="w-full md:w-48 h-48 md:h-auto relative bg-slate-100 flex-shrink-0 group overflow-hidden">
                      <img 
                        src={item.previewUrl} 
                        alt="Preview" 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      
                      {/* Bounding Box Overlay */}
                      {item.boundingBoxes && item.boundingBoxes.length > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center p-0">
                           <div className="relative w-full h-full">
                             <BoundingBoxOverlay boxes={item.boundingBoxes} />
                           </div>
                        </div>
                      )}

                      <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                        #{globalIndex + 1}
                      </div>
                      <button 
                        onClick={() => toggleCleanItem(item.id)}
                        className={`absolute bottom-2 right-2 p-1.5 rounded-lg shadow-md transition-all ${
                          item.isProcessed 
                          ? 'bg-emerald-600 text-white' 
                          : 'bg-white/90 text-slate-600 hover:bg-white'
                        }`}
                        title={item.isProcessed ? "Xem ảnh gốc" : "Lọc nền trắng"}
                      >
                        <ImageIcon size={14} />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-4 flex-grow flex flex-col gap-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-grow">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                            Văn bản trích xuất
                          </label>
                          <textarea 
                            value={item.text}
                            onChange={(e) => updateText(item.id, e.target.value)}
                            placeholder={item.status === 'processing' ? 'Đang trích xuất...' : 'Nhập văn bản phụ đề...'}
                            className="w-full bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none min-h-[80px] resize-none font-medium"
                          />
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <div className="flex flex-col gap-1">
                            <button onClick={() => moveItem(globalIndex, 'up')} className="p-1 hover:text-indigo-600 transition-colors">
                              <ChevronUp size={20} />
                            </button>
                            <button onClick={() => moveItem(globalIndex, 'down')} className="p-1 hover:text-indigo-600 transition-colors">
                              <ChevronDown size={20} />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Clock size={14} className="text-slate-400" />
                            {useFilenameTimestamps && item.startTime !== undefined && item.endTime !== undefined ? (
                              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                {formatTime(item.startTime).split(',')[0]} → {formatTime(item.endTime).split(',')[0]}
                              </span>
                            ) : (
                              <>
                                <input 
                                  type="number" 
                                  step="0.5"
                                  value={item.duration} 
                                  onChange={(e) => updateDuration(item.id, Number(e.target.value))}
                                  className="w-12 text-sm font-bold text-indigo-600 bg-transparent focus:outline-none border-b border-transparent hover:border-slate-200"
                                />
                                <span className="text-xs font-bold text-slate-400">giây</span>
                              </>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {item.status === 'processing' && (
                              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500 uppercase italic">
                                <Loader2 size={12} className="animate-spin" /> Đang xử lý
                              </span>
                            )}
                            {item.status === 'done' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">
                                  Hoàn tất
                                </span>
                                {item.confidence !== undefined && (
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                    item.confidence < minConfidence 
                                    ? 'bg-rose-100 text-rose-600' 
                                    : 'bg-emerald-100 text-emerald-600'
                                  }`}>
                                    {item.confidence}%
                                  </span>
                                )}
                              </div>
                            )}
                            {item.status === 'error' && (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs font-bold text-rose-500 uppercase tracking-wider">
                                  <AlertCircle size={12} /> Lỗi
                                </span>
                                <button 
                                  onClick={() => retryItemOCR(item.id)}
                                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                  title="Thử lại"
                                >
                                  <RefreshCcw size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <button 
                          onClick={() => removeSubtitle(item.id)}
                          className="text-slate-300 hover:text-rose-500 transition-colors p-2"
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {item.errorMessage && (
                        <div className="mt-2 text-[10px] text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 font-medium">
                          {item.errorMessage}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Empty State */}
        {subtitles.length === 0 && (
          <div className="py-12 text-center text-slate-400 italic">
            <p>Chưa có hình ảnh nào được tải lên.</p>
          </div>
        )}
      </div> {/* Close max-w-4xl */}
    </main> {/* Close main */}

    {/* Footer Action Bar */}
    {subtitles.length > 0 && (
      <motion.footer 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-slate-200 z-100 flex justify-center"
      >
        <div className="max-w-4xl w-full flex items-center justify-between gap-4">
          <div className="hidden md:flex flex-col">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tiến độ lưu trữ</span>
            <div className="flex items-center gap-2 text-indigo-900">
              <Save size={14} className="text-emerald-500" />
              <span className="text-sm font-black">Máy bộ đã lưu</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3 ml-auto">
            <button 
              onClick={clearProject}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 font-bold text-rose-500 hover:bg-rose-50 transition-colors"
              title="Xóa toàn bộ dự án"
            >
              <Trash2 size={18} />
              <span className="hidden sm:inline">XÓA TẤT CẢ</span>
            </button>
            
            <button 
              onClick={() => {
                fileInputRef.current?.click();
              }}
              className="px-6 py-3 rounded-xl bg-slate-100 border border-slate-200 font-bold text-slate-600 hover:bg-slate-200 transition-colors"
            >
              THÊM ẢNH
            </button>
            <button 
              onClick={handleDownload}
              disabled={!subtitles.some(s => s.text.trim())}
              className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all shadow-lg ${
                !subtitles.some(s => s.text.trim())
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200 active:transform active:scale-95'
              }`}
            >
              <Download size={20} />
              TẢI VỀ .SRT
            </button>
          </div>
        </div>
      </motion.footer>
    )}
  </div> // Close root div
);
}

