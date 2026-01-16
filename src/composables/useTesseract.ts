import { ref, onUnmounted } from 'vue';
import Tesseract from "tesseract.js";

interface OCRTaskOptions {
  langs?: string | string[];
  rectangle?: Tesseract.Rectangle;
  parameters?: Partial<Tesseract.WorkerParams>;
  psm?: Tesseract.PSM;
}

export default function useTesseract() {
  const { createWorker } = Tesseract
  const loading = ref(false);
  const SCALE_FACTOR = 2; // 圖片放大倍率，用於提升 OCR 識別率

  let worker: Tesseract.Worker | null = null;

  // 手動釋放 Worker 資源
  const terminate = async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
      //手動釋放組件
    }
    loading.value = false;
  };

  // 組件卸載時自動釋放，避免記憶體洩漏
  onUnmounted(() => {
    terminate();
  });

  // 通用影像前處理函式 (包含自動亮度偵測與二值化)
  const preprocessImage = async (imageSource: Blob | ImageBitmap) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is null');
    
    // 確保輸入轉為 ImageBitmap (解決 drawImage 不支援 Blob 的問題)
    let imgBitmap: ImageBitmap;
    if (imageSource instanceof Blob) {
      imgBitmap = await createImageBitmap(imageSource);
    } else {
      imgBitmap = imageSource;
    }

    // 1. 放大圖片 (提升 OCR 辨識率)
    canvas.width = imgBitmap.width * SCALE_FACTOR;
    canvas.height = imgBitmap.height * SCALE_FACTOR;
    ctx.imageSmoothingEnabled = false; 
    ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
    
    // 若是由 Blob 產生的 bitmap，繪製完後即可關閉以釋放記憶體
    if (imageSource instanceof Blob) {
      imgBitmap.close();
    }
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // --- 改良版演算法：灰階 + 對比度拉伸 (Contrast Stretching) + 自動反轉 ---
    
    let minGray = 255;
    let maxGray = 0;
    let totalBrightness = 0;
    
    // Pass 1: 計算 Min, Max, Average (遍歷所有像素以求精確)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      
      // 使用加權灰階公式
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      
      if (gray < minGray) minGray = gray;
      if (gray > maxGray) maxGray = gray;
      totalBrightness += gray;
    }
    
    const pixelCount = data.length / 4;
    const avgGray = totalBrightness / pixelCount;
    
    // 判斷是否為暗底亮字 (LCD 常見情況)
    // 門檻值設為 128 (中間值)，低於此值視為整體偏暗(暗底)，需要反轉
    const isDarkBackground = avgGray < 100; 
    
    console.log(`圖片亮度: ${avgGray.toFixed(0)}, Min: ${minGray.toFixed(0)}, Max: ${maxGray.toFixed(0)}, 模式: ${isDarkBackground ? '暗底(執行反轉)' : '亮底(保持原樣)'}`);

    // 防止除以零
    const range = maxGray - minGray;
    const scale = range === 0 ? 1 : 255 / range;

    // Pass 2: 應用對比度拉伸與反轉
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;

      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // 1. 對比度拉伸 (Contrast Stretching)
      // 將灰階值線性拉伸到 0~255，增強對比，解決陰影或低對比問題
      let normalized = (gray - minGray) * scale;
      
      // 邊界檢查
      if (normalized < 0) normalized = 0;
      if (normalized > 255) normalized = 255;

      // 2. 智慧反轉 (Smart Invert)
      // Tesseract 最佳辨識環境為「白底黑字」
      let finalPixel;
      if (isDarkBackground) {
        // 暗底亮字 -> 反轉為 -> 亮底黑字 (白底黑字)
        finalPixel = 255 - normalized;
      } else {
        // 亮底黑字 -> 保持原樣
        finalPixel = normalized;
      }

      // 3. 加強黑色 (Gamma Correction)
      // 讓深色更深，解決文字過淺的問題
      // 使用平方 (Gamma=2.0) 來壓暗中間調，使文字更黑，但保留白色背景
      finalPixel = (finalPixel * finalPixel) / 255;

      // 移除強制二值化 (Thresholding)，保留灰階細節讓 Tesseract 內部處理
      // 這能有效改善 LCD 點陣字或模糊字體的辨識率

      data[i] = finalPixel;     
      data[i + 1] = finalPixel; 
      data[i + 2] = finalPixel; 
    }

    ctx.putImageData(imageData, 0, 0);
    // 回傳 Canvas 元素，避免 ImageBitmap 在多次 recognize 時被轉移(neutered)導致後續讀取失敗
    return canvas;
  };

  // 可調整參數：options 可以是單一物件 { langs, rectangle, parameters, psm } 或 物件陣列 (用於批次處理)
  const recognizeOCR = async (imageBlob: Blob | null, options: OCRTaskOptions | OCRTaskOptions[] = {}): Promise<string | string[]> => {
    if (!imageBlob) return Array.isArray(options) ? [] : '';
    loading.value = true;

    // 1. 判斷輸入是單一任務(一張圖單一區塊)還是多任務陣列(一張圖多個區塊)
    const isBatch = Array.isArray(options);
    const tasks: OCRTaskOptions[] = isBatch ? options : [options];

    // 2. 決定初始化語言 (若為單一任務且有指定 langs 則使用，否則用預設值)
    let initLangs: string | string[] = ['eng', 'chi_sim', 'chi_tra']; // chi_sim(簡體中文), chi_tra(繁體中文)
    if (!isBatch && (options as OCRTaskOptions).langs) {
      initLangs = (options as OCRTaskOptions).langs!;
    } else if (isBatch && tasks.length > 0 && tasks[0]?.langs) {
      initLangs = tasks[0]?.langs!;
    }

    // 儲存處理後的圖片物件，以便後續釋放資源
    let processedImage: HTMLCanvasElement | null = null;

    try {
      // 如果 worker 尚未建立，則初始化 (重複使用 worker 以提升效能)
      if (!worker) {
        worker = await createWorker(initLangs, 1, {
          logger: (m: any) => console.log('logger', m),
        });
      }
      
      // 執行影像前處理 (亮度偵測、二值化)
      processedImage = await preprocessImage(imageBlob);

      // ----------------- DEBUG START -----------------
      // (除錯用) 將處理後的圖片顯示在右下角，確認二值化與反轉效果
      const debugCanvasId = 'debug-ocr-canvas';
      const oldCanvas = document.getElementById(debugCanvasId);
      if (oldCanvas) oldCanvas.remove();

      processedImage.id = debugCanvasId;
      processedImage.style.position = 'fixed';
      processedImage.style.bottom = '20px';
      processedImage.style.right = '20px';
      processedImage.style.maxWidth = '30%'; // 縮小顯示以免擋住太多畫面
      processedImage.style.zIndex = '9999';
      processedImage.style.border = '2px solid red'; // 加個紅框比較明顯
      document.body.appendChild(processedImage);
      // ----------------- DEBUG END -----------------

      const results: string[] = [];

      // 3. 串列處理 (Sequential Processing)
      for (const task of tasks) {
        const { rectangle, parameters, psm } = task;

        // 整合參數 (白名單、PSM 等)
        const finalParams: any = { ...parameters };
        if (psm) {
          finalParams['tessedit_pageseg_mode'] = psm;
        }
        // 常用 PSM 模式參考：
        // 3: AUTO (預設，自動偵測)
        // 5: SINGLE_BLOCK_VERT_TEXT (單一垂直區塊)
        // 6: SINGLE_BLOCK (單一水平區塊)
        // 7: SINGLE_LINE (單行文字)
        // 10: SINGLE_CHAR (單一字元)

        if (Object.keys(finalParams).length > 0) {
          await worker!.setParameters(finalParams);
        }

        // 修正：因為 preprocessImage 將圖片放大了 SCALE_FACTOR 倍，所以 rectangle 也要等比例放大
        const scaledRectangle: Tesseract.Rectangle | undefined = rectangle ? {
          left: rectangle.left * SCALE_FACTOR,
          top: rectangle.top * SCALE_FACTOR,
          width: rectangle.width * SCALE_FACTOR,
          height: rectangle.height * SCALE_FACTOR
        } : undefined;

        // 使用處理後的圖片進行辨識
        const result = await worker!.recognize(processedImage!, { rectangle: scaledRectangle });
        let text = result.data.text; //辨識的值

        if(psm) {
          // psm模式：垂直單字組合，移除所有空白與換行
          text = text.replace(/[\n\r\s]/g, ''); 
        } else {
          // 一般模式：移除前後空白與結尾的 \n（預設辨識結束自動加上換行符號 (\n) 來表示該行結束）
          text = text.trim(); 
        }
        console.log('result',result)
        results.push(text); //批次陣列
      }

      // 4. 更新結果 (批次則合併顯示，單一則維持原狀)
      const finalResult = isBatch ? results : (results[0] ?? '');
      
      return finalResult;
    } catch(error: any) {
      // 發生錯誤時回傳空值，避免外部解構失敗
      return isBatch ? [] : '';
    }finally {
      loading.value = false;
    }
  };

  return {
    loading,
    recognizeOCR,
    terminate
  }
}