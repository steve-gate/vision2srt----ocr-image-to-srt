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

export async function extractTextFromImage(base64Image: string, mimeType: string, deepScan: boolean = false): Promise<ExtractedText> {
  try {
    const prompt = deepScan 
      ? "Perform a DEEP SCAN of this image to extract every piece of text and its location.\n\n" +
        "Output ONLY a JSON object with:\n" +
        "- 'text': The full extracted text string.\n" +
        "- 'confidence': Integer 0-100.\n" +
        "- 'boundingBoxes': Array of { 'box_2d': [ymin, xmin, ymax, xmax], 'label': string } for detected text lines/blocks. Coordinates normalized to 1000."
      : "Extract text and its location from this image.\n\n" +
        "Output ONLY a JSON object with:\n" +
        "- 'text': The full extracted text string.\n" +
        "- 'confidence': Integer 0-100.\n" +
        "- 'boundingBoxes': Array of { 'box_2d': [ymin, xmin, ymax, xmax], 'label': string } for detected text lines/blocks. Coordinates normalized to 1000.";

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
        systemInstruction: "You are an expert OCR engine. Output coordinates normalized to 1000. Respond strictly in JSON format.",
        temperature: 0, 
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text || "{\"text\":\"\",\"confidence\":0, \"boundingBoxes\": []}");
    return {
      text: result.text || "",
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      boundingBoxes: Array.isArray(result.boundingBoxes) ? result.boundingBoxes : []
    };
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Failed to extract text from image.");
  }
}
