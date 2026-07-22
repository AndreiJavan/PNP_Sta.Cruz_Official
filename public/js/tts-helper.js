/**
 * Text-to-Speech Controller using Puter.js with native SpeechSynthesis fallback
 */
(function () {
    let currentAudio = null;
    let activeBtnId = null;

    function resetActiveButton() {
        if (!activeBtnId) return;
        const btn = document.getElementById(activeBtnId);
        if (btn) {
            btn.classList.remove('speaking', 'loading');
            btn.innerHTML = `<i class="fas fa-volume-high text-xs"></i><span>Listen</span>`;
        }
        activeBtnId = null;
    }

    async function speakReport(btnId, text) {
        if (!text || !text.trim()) return;

        const btn = document.getElementById(btnId);

        // If clicking the currently speaking button, stop playback
        if (activeBtnId === btnId) {
            stopSpeech();
            return;
        }

        // Stop any active audio/speech
        stopSpeech();

        activeBtnId = btnId;
        if (btn) {
            btn.classList.add('loading');
            btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xs"></i><span>Loading...</span>`;
        }

        const cleanText = text.replace(/<[^>]*>/g, '').trim();

        // 1. Try Puter.js TTS
        if (typeof puter !== 'undefined' && puter.ai && typeof puter.ai.txt2speech === 'function') {
            try {
                const audio = await puter.ai.txt2speech(cleanText);
                currentAudio = audio;

                audio.onended = () => {
                    resetActiveButton();
                    currentAudio = null;
                };

                audio.onerror = () => {
                    console.warn("Puter.js TTS playback failed, attempting native browser fallback.");
                    fallbackNativeSpeech(cleanText);
                };

                if (btn) {
                    btn.classList.remove('loading');
                    btn.classList.add('speaking');
                    btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
                }

                await audio.play();
                return;
            } catch (err) {
                console.warn("Puter.js TTS error:", err, "Falling back to Web Speech API.");
            }
        }

        // 2. Fallback to native Web Speech API
        fallbackNativeSpeech(cleanText);
    }

    function fallbackNativeSpeech(cleanText) {
        if (!('speechSynthesis' in window)) {
            alert('Text-to-speech is not supported in this browser.');
            resetActiveButton();
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            resetActiveButton();
        };

        utterance.onerror = () => {
            resetActiveButton();
        };

        if (activeBtnId) {
            const btn = document.getElementById(activeBtnId);
            if (btn) {
                btn.classList.remove('loading');
                btn.classList.add('speaking');
                btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
            }
        }

        window.speechSynthesis.speak(utterance);
    }

    function stopSpeech() {
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            } catch (e) {}
            currentAudio = null;
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        resetActiveButton();
    }

    // Expose global methods
    window.speakReport = speakReport;
    window.stopSpeech = stopSpeech;
})();
