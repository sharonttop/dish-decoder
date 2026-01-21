<script setup lang="ts">
import { onMounted, onUnmounted, ref, reactive } from 'vue';
import { useCamera } from '@/composables/useCamera';
import useTesseract from '@/composables/useTesseract';

const { 
  videoRef, 
  error, 
  isLoading, 
  startCamera, 
  takePhoto,
  hasFlash,
  toggleFlash
} = useCamera();

const { recognizeOCR } = useTesseract();

const isShutterEffect = ref(false);
const statusMessage = ref('');
const showResult = ref(false);
const scanResult = ref('');

// --- 動態掃描框邏輯 Start ---
const overlayRef = ref<HTMLElement | null>(null);
const box = reactive({ x: 0, y: 0, width: 0, height: 0 });

// 初始化框框位置 (預設置中，80% 寬，40% 高)
const initBox = () => {
  if (overlayRef.value) {
    const { clientWidth, clientHeight } = overlayRef.value;
    box.width = clientWidth * 0.8;
    box.height = clientHeight * 0.4; // 預設高度稍微小一點，方便調整
    box.x = (clientWidth - box.width) / 2;
    box.y = (clientHeight - box.height) / 2;
  }
};

// 拖曳與縮放狀態
let isDragging = false;
let isResizing = false;
let startX = 0;
let startY = 0;
let startBoxX = 0;
let startBoxY = 0;
let startBoxW = 0;
let startBoxH = 0;

const onTouchStart = (e: TouchEvent | MouseEvent, type: 'drag' | 'resize') => {
  // 取得觸控或滑鼠座標
  const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
  const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : (e as MouseEvent).clientY;
  
  startX = clientX;
  startY = clientY;

  if (type === 'drag') {
    isDragging = true;
    startBoxX = box.x;
    startBoxY = box.y;
  } else {
    isResizing = true;
    startBoxW = box.width;
    startBoxH = box.height;
  }

  // 綁定移動與結束事件到 document，避免拖太快滑出元素
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

const handleMove = (clientX: number, clientY: number) => {
  if (!overlayRef.value) return;
  const { clientWidth, clientHeight } = overlayRef.value;
  const dx = clientX - startX;
  const dy = clientY - startY;

  if (isDragging) {
    let newX = startBoxX + dx;
    let newY = startBoxY + dy;
    // 邊界檢查：不讓框框跑出畫面
    newX = Math.max(0, Math.min(newX, clientWidth - box.width));
    newY = Math.max(0, Math.min(newY, clientHeight - box.height));
    box.x = newX;
    box.y = newY;
  } else if (isResizing) {
    let newW = startBoxW + dx;
    let newH = startBoxH + dy;
    // 最小尺寸限制 (例如 50px)
    newW = Math.max(50, Math.min(newW, clientWidth - box.x));
    newH = Math.max(50, Math.min(newH, clientHeight - box.y));
    box.width = newW;
    box.height = newH;
  }
};

// 包裝事件處理器
const onTouchMove = (e: TouchEvent) => { 
  e.preventDefault();
  const touch = e.touches[0];
  if (touch) {
    handleMove(touch.clientX, touch.clientY);
  }
};
const onMouseMove = (e: MouseEvent) => { e.preventDefault(); handleMove(e.clientX, e.clientY); };
const onTouchEnd = () => cleanupEvents();
const onMouseUp = () => cleanupEvents();

const cleanupEvents = () => {
  isDragging = false;
  isResizing = false;
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
};
// --- 動態掃描框邏輯 End ---

onMounted(() => {
  // 讀取 videoRef 以避免 TS6133 錯誤，並確認元素已正確綁定
  if (!videoRef.value) console.warn('Video ref not bound');
  startCamera(); // 進入頁面自動開啟相機
  
  // 初始化框框
  initBox();
  window.addEventListener('resize', initBox);
});

onUnmounted(() => {
  window.removeEventListener('resize', initBox);
});

const handleScan = async () => {
  // 1. 立即給予快門回饋 (閃光 + 震動)
  isShutterEffect.value = true;
  if (navigator.vibrate) navigator.vibrate(50); // 手機震動 50ms
  setTimeout(() => isShutterEffect.value = false, 150);

  const imageBlob = await takePhoto();
  if (imageBlob && videoRef.value) {
    console.log('截圖成功！Blob 大小:', imageBlob.size);
    // 2. 顯示成功提示
    statusMessage.value = '截圖成功！';
    // setTimeout(() => statusMessage.value = '', 2000); // 2秒後消失
    // Tesseract Worker
    // recognize(imageBlob);

    // 計算裁切區域 (ROI) 以提升手機辨識準確度
    const video = videoRef.value;
    const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
    
    // 修正：需考慮 takePhoto 的裁切邏輯 (object-fit: cover)
    // takePhoto 會根據螢幕比例裁切影片，因此 Blob 的尺寸不一定等於 videoWidth/videoHeight
    const displayAspect = clientWidth / clientHeight;
    const videoAspect = videoWidth / videoHeight;
    
    let blobWidth = videoWidth;
    let blobHeight = videoHeight;

    if (videoAspect > displayAspect) {
      // 影片比螢幕寬 -> 裁切左右 (Blob 高度 = 影片高度)
      blobWidth = videoHeight * displayAspect;
    } else {
      // 影片比螢幕高 -> 裁切上下 (Blob 寬度 = 影片寬度)
      blobHeight = videoWidth / displayAspect;
    }

    // 計算螢幕到 Blob 的縮放比例
    const scale = blobWidth / clientWidth;

    // 使用動態調整後的 box 數值
    const rectWidth = box.width * scale;
    const rectHeight = box.height * scale;
    const rectLeft = box.x * scale;
    const rectTop = box.y * scale;

    const ocr = {
      psm: 3, // 3: AUTO (自動分頁，適合整張菜單或多行文字)
      // parameters: { tessedit_char_whitelist: '0123456789.' }
    }
    const result = await recognizeOCR(imageBlob, {
      rectangle: {
        left: rectLeft,
        top: rectTop,
        width: rectWidth,
        height: rectHeight
      },
      // parameters: ocr.parameters,
      psm: ocr.psm as any
    });
    // 將結果填入當前步驟的 input
    if (result) {
      // steps.value[currentStepIndex.value].value = result;
      // statusMessage.value = `掃描完成: ${result}`;
      scanResult.value = Array.isArray(result) ? result.join('\n\n') : result;
      showResult.value = true;
      
      // 若需要自動跳到下一步，可取消註解以下程式碼
      // if (currentStepIndex.value < steps.value.length - 1) {
      //   currentStepIndex.value++;
      // }
    }
  }
};

const copyText = () => {
  navigator.clipboard.writeText(scanResult.value);
  statusMessage.value = '已複製到剪貼簿';
};

</script>

<template>
  <div class="camera-container">
    <!-- 掃描框 (ROI) -->
    <div class="scan-overlay" ref="overlayRef">
      <div 
        class="scan-box"
        :style="{ left: box.x + 'px', top: box.y + 'px', width: box.width + 'px', height: box.height + 'px' }"
        @touchstart.stop="onTouchStart($event, 'drag')"
        @mousedown.stop="onTouchStart($event, 'drag')"
      >
        <!-- 右下角調整大小手柄 -->
        <div class="resize-handle"
          @touchstart.stop.prevent="onTouchStart($event, 'resize')"
          @mousedown.stop.prevent="onTouchStart($event, 'resize')"
        ></div>
      </div>
      <p class="scan-text">拖曳移動，右下角調整大小</p>
    </div>

    <!-- 掃描結果彈窗 (Modal) -->
    <div v-if="showResult" class="result-modal">
      <div class="result-content">
        <div class="result-header">
          <h3>辨識結果</h3>
          <button class="close-btn" @click="showResult = false">✕</button>
        </div>
        <div class="result-body">
          <pre>{{ scanResult }}</pre>
        </div>
        <div class="result-footer">
          <button class="action-btn" @click="copyText">複製文字</button>
        </div>
      </div>
    </div>

    <!-- 快門閃光特效 (全螢幕閃白) -->
    <div v-if="isShutterEffect" class="absolute inset-0 bg-white z-50 opacity-80 pointer-events-none transition-opacity duration-150"></div>

    <!-- 狀態提示訊息 (Toast) -->
    <div v-if="statusMessage" class="absolute top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <div class="bg-black/70 text-white px-4 py-2 rounded-full text-sm backdrop-blur-sm shadow-lg">
        {{ statusMessage }}
      </div>
    </div>

    <div v-if="error" class="error-msg bg-white">
      {{ error }}
      <button @click="startCamera">重試</button>
    </div>

    <div v-if="isLoading" class="loading">
      相機啟動中...
    </div>

    <video 
      ref="videoRef" 
      autoplay 
      playsinline 
      muted
      class="camera-view"
    ></video>

    <div class="controls">
      <button v-if="hasFlash" @click="toggleFlash">🔦</button>
      <button class="shutter-btn" @click="handleScan"></button>
      <button class="shutter-btn" @click="statusMessage = ''">🧽</button>
    </div>
  </div>
</template>

<style scoped>
.camera-container {
  position: relative;
  width: 100%;
  height: 100vh;
  background: #000;
  overflow: hidden;
}

.camera-view {
  width: 100%;
  height: 100%;
  object-fit: cover; /* 讓畫面填滿，類似 IG 限動效果 */
}

.controls {
  position: absolute;
  bottom: 40px;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  gap: 20px;
  z-index: 10;
}

.shutter-btn {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: white;
  border: 4px solid rgba(255,255,255,0.3);
  cursor: pointer;
}

.scan-overlay {
  position: absolute;
  inset: 0;
  /* 移除 flex 置中，改由 JS 控制位置 */
  overflow: hidden;
  z-index: 10;
}

.scan-box {
  position: absolute; /* 改為絕對定位 */
  border: 2px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5); /* 半透明遮罩效果 */
  border-radius: 8px;
  cursor: move;
  touch-action: none; /* 防止拖曳時觸發瀏覽器捲動 */
}

/* 調整大小的手柄樣式 */
.resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.8) 50%);
  cursor: nwse-resize;
  border-radius: 0 0 6px 0;
  touch-action: none;
}

.scan-text {
  position: absolute;
  bottom: 120px; /* 固定在下方，避免跟隨框框亂跑 */
  width: 100%;
  text-align: center;
  color: white;
  font-size: 14px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  pointer-events: none;
}

/* 結果彈窗樣式 */
.result-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.result-content {
  background: white;
  width: 100%;
  max-width: 600px;
  max-height: 80vh; /* 限制高度，超過捲動 */
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}

.result-header {
  padding: 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: bold;
  color: #333;
}

.result-body {
  padding: 16px;
  overflow-y: auto; /* 內容過長時可捲動 */
  flex: 1;
  background: #f9f9f9;
}

.result-body pre {
  white-space: pre-wrap; /* 保留換行與空格 */
  word-wrap: break-word; /* 防止長單字跑版 */
  font-family: inherit;
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  margin: 0;
}

.result-footer {
  padding: 12px 16px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0 8px;
}

.action-btn {
  background: #000;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
</style>