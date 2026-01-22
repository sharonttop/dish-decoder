// src/composables/useGemini.ts
import { ref } from 'vue';


interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GeminiOptions {
  rect?: CropRect;
  lang?: string;
}

export function useGemini() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  // 通用 API 呼叫函式：自動判斷是開發環境(直連)還是生產環境(Proxy)
  const callGeminiApi = async (payload: any) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    
    if (apiKey) {
      // [開發模式] 前端直連 (方便 Debug)
      console.warn('⚠️ Dev Mode: Using API Key from env.');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || res.statusText);
      }
      return await res.json();
    } else {
      // [生產模式] 呼叫後端 Proxy (安全)
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error('API Proxy not found (/api/gemini). Please deploy to Vercel.');
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || 'Proxy Error');
      }
      return await res.json();
    }
  };

  // 裁切圖片並轉為 Base64
  const processImage = async (blob: Blob, rect?: CropRect): Promise<string> => {
    const imgBitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Canvas context creation failed');

    if (rect) {
      // 設定畫布大小為裁切區域大小
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      // 從原圖裁切指定區域繪製到 Canvas (sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      ctx.drawImage(
        imgBitmap, 
        rect.left, rect.top, rect.width, rect.height, 
        0, 0, rect.width, rect.height
      );
    } else {
      canvas.width = imgBitmap.width;
      canvas.height = imgBitmap.height;
      ctx.drawImage(imgBitmap, 0, 0);
    }

    // 轉為 Base64 (移除 data:image/jpeg;base64, 前綴)
    // 加入 || '' 防止 split 結果為 undefined
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] || '';
  };

  const recognizeWithGemini = async (imageBlob: Blob, options: GeminiOptions = {}) => {
    loading.value = true;
    error.value = null;

    try {
      const base64Image = await processImage(imageBlob, options.rect);
      
      // 根據語言設定提示詞
      let prompt = "Please transcribe the text in this image exactly as it appears. Output plain text only. Do not add markdown formatting.";
      if (options.lang === 'chi_tra') prompt += " The text is Traditional Chinese.";
      if (options.lang === 'chi_sim') prompt += " The text is Simplified Chinese.";
      if (options.lang === 'eng') prompt += " The text is English.";

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: base64Image } }
          ]
        }]
      };

      const data = await callGeminiApi(payload);
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return resultText.trim();

    } catch (err: any) {
      console.error('Gemini OCR Failed:', err);
      error.value = err.message || '辨識失敗';
      return '';
    } finally {
      loading.value = false;
    }
  };

  const translateWithGemini = async (text: string, targetLang: string) => {
    loading.value = true;
    error.value = null;

    try {
      // 使用簡短 Prompt 以節省 Token 流量
      const prompt = `Translate to ${targetLang}:\n${text}`;
      
      const payload = {
        contents: [{
          parts: [{ text: prompt }]
        }]
      };

      const data = await callGeminiApi(payload);
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return resultText.trim();
    } catch (err: any) {
      console.error('Gemini Translation Failed:', err);
      error.value = err.message || '翻譯失敗';
      return '';
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    recognizeWithGemini,
    translateWithGemini
  };
}
