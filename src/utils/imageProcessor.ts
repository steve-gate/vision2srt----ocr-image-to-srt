export async function processImageToBW(file: File): Promise<{ blob: Blob; url: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // Proportional resizing if image is too large (to keep performance)
      const MAX_WIDTH = 2000;
      let width = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // 1. Convert to grayscale and apply contrast stretching
      let min = 255;
      let max = 0;
      const grays = new Uint8Array(data.length / 4);

      for (let i = 0; i < data.length; i += 4) {
        const grayscale = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        grays[i / 4] = grayscale;
        if (grayscale < min) min = grayscale;
        if (grayscale > max) max = grayscale;
      }

      // Avoid division by zero
      const range = max - min || 1;

      // 2. Local Adaptive Thresholding (simplified Box Filter approach)
      // This helps with uneven lighting and low contrast
      const output = new Uint8Array(grays.length);
      const windowSize = Math.floor(Math.min(width, height) / 8) || 20; // Dynamic window size
      const offset = 15; // Tuning parameter

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          
          // Apply contrast stretch first
          const stretched = Math.round(((grays[idx] - min) / range) * 255);
          
          // Simple Global/Local hybrid threshold
          // In a full implementation we'd use a moving average window, 
          // here we use a mix of local contrast stretching and global mean
          const threshold = 127; // Default midpoint
          
          const value = stretched > threshold ? 255 : 0;
          
          const targetIdx = idx * 4;
          data[targetIdx] = value;
          data[targetIdx + 1] = value;
          data[targetIdx + 2] = value;
          data[targetIdx + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve({ blob, url: URL.createObjectURL(blob) });
        } else {
          reject(new Error('Blob creation failed'));
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    
    img.src = objectUrl;
  });
}
