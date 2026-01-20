import { ref, onUnmounted, type Ref } from 'vue';

interface UseCameraReturn {
  videoRef: Ref<HTMLVideoElement | null>;
  stream: Ref<MediaStream | null>;
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  takePhoto: () => Promise<Blob | null>;
  hasFlash: Ref<boolean>;
  toggleFlash: () => Promise<void>;
}

export function useCamera(): UseCameraReturn {
  const videoRef = ref<HTMLVideoElement | null>(null);
  const stream = ref<MediaStream | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const hasFlash = ref(false);
  
  let videoTrack: MediaStreamTrack | null = null;

  const startCamera = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { exact: 'environment' }, // 強制使用後鏡頭 ('environment')，若在電腦測試報錯，可改為 'user' 或拿掉 exact，
          width: { ideal: 1920 }, // 盡量拿高畫質，但截圖時會縮小
          height: { ideal: 1080 }
        }
      };

      // 處理電腦瀏覽器可能不支援 'environment' 的 fallback
      try {
        stream.value = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback: 如果沒有後鏡頭，就隨便抓一個可用的
        stream.value = await navigator.mediaDevices.getUserMedia({ 
            audio: false, 
            video: true 
        });
      }

      // 綁定到 Video 元素
      if (videoRef.value && stream.value) {
        videoRef.value.srcObject = stream.value;
        // 等待 metadata 載入完成再播放，避免黑屏
        videoRef.value.onloadedmetadata = () => {
          videoRef.value?.play();
        };

        // 取得視訊軌道 (用於控制閃光燈或停止)
        videoTrack = stream.value.getVideoTracks()[0] ?? null;
        
        // 檢查是否支援閃光燈 (Torch)
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities();
          hasFlash.value = !!(capabilities as any).torch;
        }
      }
    } catch (err: any) {
      console.error('Camera Error:', err);
      if (err.name === 'NotAllowedError') {
        error.value = '請允許相機權限以使用掃描功能。';
      } else if (err.name === 'NotFoundError') {
        error.value = '找不到相機裝置。';
      } else {
        error.value = `相機啟動失敗: ${err.message}`;
      }
    } finally {
      isLoading.value = false;
    }
  };

  // 停止相機 (釋放資源)
  const stopCamera = () => {
    if (stream.value) {
      stream.value.getTracks().forEach(track => track.stop());
      stream.value = null;
    }
    videoTrack = null;
  };

  // 截圖功能 (回傳 Blob 供 Tesseract 使用)
  const takePhoto = async (): Promise<Blob | null> => {
    if (!videoRef.value) return null;

    const video = videoRef.value;

    // 計算裁切區域以符合螢幕顯示比例 (WYSIWYG)
    const displayAspect = video.clientWidth / video.clientHeight;
    const videoAspect = video.videoWidth / video.videoHeight;
    
    let sx = 0, sy = 0, sWidth = video.videoWidth, sHeight = video.videoHeight;

    if (videoAspect > displayAspect) {
      // 影片比螢幕寬 -> 裁切左右
      sWidth = sHeight * displayAspect;
      sx = (video.videoWidth - sWidth) / 2;
    } else {
      // 影片比螢幕高 -> 裁切上下
      sHeight = sWidth / displayAspect;
      sy = (video.videoHeight - sHeight) / 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width = sWidth;
    canvas.height = sHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 將當下的 Video Frame 畫到 Canvas 上
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      // 轉成 Blob (image/jpeg, 品質 0.8)
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.8);
    });
  };

  // 控制閃光燈
  const toggleFlash = async () => {
    if (!videoTrack || !hasFlash.value) return;
    
    const settings = videoTrack.getSettings();
    const isFlashOn = settings.torch || false; // torch 是 Web 標準屬性

    await videoTrack.applyConstraints({
      advanced: [{ torch: !isFlashOn } as any] // TypeScript 有時還沒定義 torch，轉 any 繞過
    });
  };

  
  onUnmounted(() => {
    stopCamera(); // 組件卸載時自動關閉相機
  });

  return {
    videoRef,
    stream,
    isLoading,
    error,
    hasFlash,
    startCamera,
    stopCamera,
    takePhoto,
    toggleFlash
  };
}