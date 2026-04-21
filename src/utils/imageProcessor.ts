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

      // 1. Convert to grayscale and apply aggressive contrast enhancement
      const grays = new Uint8Array(data.length / 4);
      let min = 255;
      let max = 0;

      for (let i = 0; i < data.length; i += 4) {
        // Luminance conversion
        const grayscale = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        grays[i / 4] = grayscale;
        if (grayscale < min) min = grayscale;
        if (grayscale > max) max = grayscale;
      }

      // 2. Adaptive Thresholding (Bradley-Roth using Integral Image)
      const integral = new Float64Array(width * height);
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          sum += grays[idx];
          if (y === 0) {
            integral[idx] = sum;
          } else {
            integral[idx] = integral[(y - 1) * width + x] + sum;
          }
        }
      }

      const s = Math.floor(width / 32); // Smaller window for better local detail
      const t = 18; // Slightly more aggressive threshold

      // Better detection: count highlights and midtones in the bottom half where subtitles usually are
      let darkPixels = 0;
      const bottomStart = Math.floor(height * 0.6);
      let totalBottomPixels = 0;
      for (let y = bottomStart; y < height; y++) {
        for (let x = 0; x < width; x++) {
          totalBottomPixels++;
          if (grays[y * width + x] < 127) darkPixels++;
        }
      }
      const isMostlyDark = darkPixels > (totalBottomPixels * 0.6);

      // Create a temporary buffer for thresholded results
      const thresholded = new Uint8Array(width * height);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const x1 = Math.max(0, x - s / 2);
          const x2 = Math.min(width - 1, x + s / 2);
          const y1 = Math.max(0, y - s / 2);
          const y2 = Math.min(height - 1, y + s / 2);
          const count = (x2 - x1) * (y2 - y1);
          
          const sum = integral[Math.floor(y2 * width + x2)] - 
                      integral[Math.floor(y1 * width + x2)] - 
                      integral[Math.floor(y2 * width + x1)] + 
                      integral[Math.floor(y1 * width + x1)];

          const gray = grays[idx];
          
          let isForeground;
          if (isMostlyDark) {
            // Bright text on dark bg
            isForeground = gray * count > sum * (100 + t) / 100;
          } else {
            // Dark text on bright bg
            isForeground = gray * count < sum * (100 - t) / 100;
          }

          thresholded[idx] = isForeground ? 0 : 255;
        }
      }

      // 3. Noise reduction - Despeckle pass (remove isolated pixels)
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (thresholded[idx] === 0) { // Black pixel
            // If surrounded by white, it might be noise
            let whiteNeighbors = 0;
            if (thresholded[idx - 1] === 255) whiteNeighbors++;
            if (thresholded[idx + 1] === 255) whiteNeighbors++;
            if (thresholded[idx - width] === 255) whiteNeighbors++;
            if (thresholded[idx + width] === 255) whiteNeighbors++;
            
            if (whiteNeighbors >= 4) {
              thresholded[idx] = 255; // Clean it up to white
            }
          }
        }
      }

      // Apply result back to original image data
      for (let i = 0; i < thresholded.length; i++) {
        const val = thresholded[i];
        const targetIdx = i * 4;
        
        // If val is 0 (Black/Foreground), set as Solid Black
        // If val is 255 (White/Background), set as Transparent
        data[targetIdx] = 0;
        data[targetIdx + 1] = 0;
        data[targetIdx + 2] = 0;
        data[targetIdx + 3] = val === 0 ? 255 : 0;
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
