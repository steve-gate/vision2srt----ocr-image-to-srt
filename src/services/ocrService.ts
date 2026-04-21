import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface BoundingBox {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  label: string;
}

export interface ExtractedText {
  text: string;
  confidence: number;
  boundingBoxes?: BoundingBox[];
}

export async function extractTextFromImage(
  base64Image: string, 
  mimeType: string, 
  deepScan: boolean = false,
  language: string = "Vietnamese"
): Promise<ExtractedText> {
  let retries = 0;
  const maxRetries = 3;
  const baseDelay = 1000;

  while (retries <= maxRetries) {
    try {
      const prompt = deepScan 
        ? `You are an advanced OCR engine specialized in subtitles. The expected language is ${language}. ` +
          "Extract every piece of text from this image accurately, preserving punctuation and specific characters of this language. " +
          "If there are multiple blocks, sort them logically (top to bottom). " +
          "Output ONLY a pure JSON object without markdown code blocks. " +
          "Structure:\n" +
          "{\n" +
          "  \"text\": \"full text content\",\n" +
          "  \"confidence\": 0-100,\n" +
          "  \"boundingBoxes\": [{ \"box_2d\": [ymin, xmin, ymax, xmax], \"label\": \"text portion\" }]\n" +
          "}"
        : `Extract all visible text from this image. Expected language: ${language}. Focus on accuracy and specific characters. ` +
          "Output ONLY a JSON object. Structure: { \"text\": \"...\", \"confidence\": 0-100, \"boundingBoxes\": [{ \"box_2d\": [ymin, xmin, ymax, xmax], \"label\": \"...\" }] }";

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image.split(',')[1] || base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          systemInstruction: "You are a professional OCR analyzer. Your output must be valid JSON only. Coordinates are normalized to 1000.",
          temperature: 0, 
          responseMimeType: "application/json"
        }
      });

      // Sanitization: Remove markdown code blocks if present
      let cleanedText = response.text || "";
      cleanedText = cleanedText.replace(/```json/g, "").replace(/```/g, "").trim();

      const result = JSON.parse(cleanedText || "{\"text\":\"\",\"confidence\":0, \"boundingBoxes\": []}");
      return {
        text: result.text || "",
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
        boundingBoxes: Array.isArray(result.boundingBoxes) ? result.boundingBoxes : []
      };
    } catch (error: any) {
      const errorMsg = error?.message || "";
      const isRateLimit = errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit && retries < maxRetries) {
        retries++;
        const delay = baseDelay * Math.pow(2, retries - 1);
        console.warn(`OCR Rate limited. Retrying in ${delay}ms... (Attempt ${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error("OCR Error:", error);
      if (isRateLimit) {
        throw new Error("Hết hạn mức API (Rate Limit). Vui lòng đợi một lát rồi thử lại.");
      }
      throw new Error("Không thể trích xuất văn bản từ hình ảnh.");
    }
  }
  throw new Error("Failed after multiple retries.");
}
