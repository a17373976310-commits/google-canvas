
import { GoogleGenAI, Modality } from "@google/genai";

export class GeminiService {
  /**
   * Initializes a new GoogleGenAI instance.
   * Always use a new instance to ensure the most up-to-date API key is used.
   */
  private getAI() {
    return new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
  }

  async generateText(prompt: string) {
    const ai = this.getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  }

  async generateImage(prompt: string) {
    const ai = this.getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        imageConfig: { aspectRatio: "1:1" }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No image generated');
  }

  async generateAudio(prompt: string) {
    const ai = this.getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error('No audio generated');
    // Raw PCM data returned as base64 string
    return `data:audio/pcm;base64,${base64Audio}`;
  }

  async generateVideo(prompt: string) {
    // Check if API key is selected for Veo models
    if (!(window as any).aistudio?.hasSelectedApiKey()) {
       (window as any).aistudio?.openSelectKey();
       // Proceed immediately to avoid race conditions as per guidelines
    }

    try {
      // Create fresh instance right before making the call
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error('Video generation failed to return a download link.');

      // Fetch the video bytes using the API key
      const response = await fetch(`${downloadLink}&key=${import.meta.env.VITE_GEMINI_API_KEY}`);
      if (!response.ok) throw new Error(`Video fetch failed: ${response.statusText}`);
      
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err: any) {
      // Handle key selection requirement if the request fails
      if (err.message?.includes("Requested entity was not found.")) {
         (window as any).aistudio?.openSelectKey();
      }
      throw err;
    }
  }
}
