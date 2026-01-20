<script setup lang="ts">
import { onMounted, ref } from 'vue';
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

onMounted(() => {
  // 讀取 videoRef 以避免 TS6133 錯誤，並確認元素已正確綁定
  if (!videoRef.value) console.warn('Video ref not bound');
  startCamera(); // 進入頁面自動開啟相機

});

const handleScan = async () => {
  // 1. 立即給予快門回饋 (閃光 + 震動)
  isShutterEffect.value = true;
  if (navigator.vibrate) navigator.vibrate(50); // 手機震動 50ms
  setTimeout(() => isShutterEffect.value = false, 150);

  const imageBlob = await takePhoto();
  if (imageBlob) {
    console.log('截圖成功！Blob 大小:', imageBlob.size);
    // 2. 顯示成功提示
    statusMessage.value = '截圖成功！';
    // setTimeout(() => statusMessage.value = '', 2000); // 2秒後消失
    // Tesseract Worker
    // recognize(imageBlob);
    const ocr = {
      psm: 7, // 7: SINGLE_LINE (單行文字)
      // parameters: { tessedit_char_whitelist: '0123456789.' }
    }
    const result = await recognizeOCR(imageBlob, {
      // rectangle: rectangle,
      // parameters: ocr.parameters,
      psm: ocr.psm as any
    });
    // 將結果填入當前步驟的 input
    if (result) {
      // steps.value[currentStepIndex.value].value = result;
      statusMessage.value = `掃描完成: ${result}`;
      
      // 若需要自動跳到下一步，可取消註解以下程式碼
      // if (currentStepIndex.value < steps.value.length - 1) {
      //   currentStepIndex.value++;
      // }
    }
  }
};


</script>

<template>
  <div class="camera-container">
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
}

.shutter-btn {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: white;
  border: 4px solid rgba(255,255,255,0.3);
  cursor: pointer;
}
</style>