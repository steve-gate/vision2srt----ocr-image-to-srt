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

      // 2. Adaptive Thresholding (Bradley-Roth using Integral Image)
      // This is far superior for OCR as it handles uneven lighting/shading
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

      const s = Math.floor(width / 8); // Window size
      const t = 15; // Threshold percentage (adjustable)

      // Determine if image is mostly dark (bright text on dark bg) or bright (dark text on light bg)
      // This heuristic helps us decide whether to invert the adaptive result to get Black-on-White
      let darkPixels = 0;
      for (let i = 0; i < grays.length; i++) {
        if (grays[i] < 127) darkPixels++;
      }
      const isMostlyDark = darkPixels > (grays.length / 2);

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
          
          // Adaptive logic: value is white if it's much brighter than local mean, else black
          // But we want it consistent: Black text on White background.
          // We apply the same inversion logic as before but locally.
          
          let isBlack;
          if (gray * count < sum * (100 - t) / 100) {
            isBlack = true; // Local dark -> text (if dark on bright)
          } else {
            isBlack = false; // Local bright -> bg
          }

          // Heuristic to maintain "Black Text on White BG"
          // If the original image was mostly dark, we invert the result
          let finalValue = isBlack ? 0 : 255;
          if (isMostlyDark) {
            finalValue = isBlack ? 255 : 0;
          }

          const targetIdx = idx * 4;
          data[targetIdx] = finalValue;
          data[targetIdx + 1] = finalValue;
          data[targetIdx + 2] = finalValue;
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
