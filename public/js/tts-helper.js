/**
 * Text-to-Speech Controller using Puter.js with support for Language Selection (Filipino / English)
 * and native Web Speech API fallback for visually impaired accessibility.
 */
(function () {
    let currentAudio = null;
    let activeBtnId = null;
    let selectedLanguage = localStorage.getItem('tts_preferred_lang') || 'fil-PH';

    function resetActiveButton() {
        if (!activeBtnId) return;
        const btn = document.getElementById(activeBtnId);
        if (btn) {
            btn.classList.remove('speaking', 'loading');
            if (btn.dataset.originalHtml) {
                btn.innerHTML = btn.dataset.originalHtml;
            } else {
                btn.innerHTML = `<i class="fas fa-volume-high text-xs"></i><span>Listen</span>`;
            }
        }
        activeBtnId = null;
    }

    function getSelectedLanguage() {
        const langSelect = document.getElementById('global-tts-lang-select');
        if (langSelect) {
            return langSelect.value;
        }
        return selectedLanguage;
    }

    function setLanguagePreference(lang) {
        selectedLanguage = lang;
        localStorage.setItem('tts_preferred_lang', lang);
        // Sync any language selector dropdowns on the page
        const selectors = document.querySelectorAll('.tts-lang-select');
        selectors.forEach(sel => sel.value = lang);
    }

    async function handlePuterSpeech(text, botType, btn, fallbackLang) {
        if (typeof puter === 'undefined') {
            console.warn('Puter.js not loaded. Falling back to native.');
            fallbackNativeSpeech(text, fallbackLang);
            return;
        }
        
        try {
            const provider = botType === 'puter-openai' ? 'openai' : 'google';
            const audio = await puter.ai.txt2speech(text, { provider: provider });
            currentAudio = audio;
            
            if (btn) {
                btn.classList.remove('loading');
                btn.classList.add('speaking');
                btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
            }
            
            audio.onended = () => { resetActiveButton(); };
            audio.onerror = () => { resetActiveButton(); };
            audio.play();
        } catch(err) {
            console.error('Puter TTS error:', err);
            fallbackNativeSpeech(text, fallbackLang);
        }
    }

    async function speakReport(btnId, text, langOverride, botType = 'browser') {
        if (!text || !text.trim()) return;

        const btn = document.getElementById(btnId);
        const lang = langOverride || getSelectedLanguage();

        // If clicking the currently speaking button, stop playback
        if (activeBtnId === btnId) {
            stopSpeech();
            return;
        }

        // Stop any active audio/speech
        stopSpeech();

        activeBtnId = btnId;
        if (btn) {
            if (!btn.dataset.originalHtml) {
                btn.dataset.originalHtml = btn.innerHTML;
            }
            btn.classList.add('loading');
            btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xs"></i><span>Loading...</span>`;
        }

        const cleanText = text.replace(/<[^>]*>/g, '').trim();

        // Ensure browser compatibility shim for crypto.createHash if referenced internally by third-party libs
        if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.createHash !== 'function') {
            try {
                window.crypto.createHash = function () {
                    return {
                        update: function () { return this; },
                        digest: function () { return '00000000000000000000000000000000'; }
                    };
                };
            } catch (e) {}
        }

        if (botType.startsWith('puter-')) {
            handlePuterSpeech(cleanText, botType, btn, lang);
        } else {
            fallbackNativeSpeech(cleanText, lang);
        }
    }

    async function speakTagalogReport(btnId, text, botType = 'browser') {
        if (!text || !text.trim()) return;

        const btn = document.getElementById(btnId);

        if (activeBtnId === btnId) {
            stopSpeech();
            return;
        }

        stopSpeech();
        activeBtnId = btnId;
        
        if (btn) {
            if (!btn.dataset.originalHtml) {
                btn.dataset.originalHtml = btn.innerHTML;
            }
            btn.classList.add('loading');
            btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xs"></i><span>Translating...</span>`;
        }

        const cleanText = text.replace(/<[^>]*>/g, '').trim();

        try {
            const response = await fetch('/api/translate-tagalog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleanText })
            });
            const data = await response.json();
            const tagalogText = data.success && data.tagalogText ? data.tagalogText : cleanText;
            
            if (botType.startsWith('puter-')) {
                handlePuterSpeech(tagalogText, botType, btn, 'fil-PH');
            } else {
                fallbackNativeSpeech(tagalogText, 'fil-PH');
            }
        } catch (error) {
            console.error('Translation error:', error);
            if (botType.startsWith('puter-')) {
                handlePuterSpeech(cleanText, botType, btn, 'fil-PH');
            } else {
                fallbackNativeSpeech(cleanText, 'fil-PH');
            }
        }
    }

    function fallbackNativeSpeech(cleanText, lang) {
        if (!('speechSynthesis' in window)) {
            alert('Text-to-speech is not supported in this browser.');
            resetActiveButton();
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        
        // Check if the requested language voice actually exists
        const voices = window.speechSynthesis.getVoices();
        const hasLangVoice = voices.some(v => v.lang.toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));
        
        if (lang === 'fil-PH' && !hasLangVoice) {
            console.warn('Filipino voice not found on this device. Falling back to default voice.');
            utterance.lang = 'en-US';
        } else {
            utterance.lang = lang || 'en-US';
        }
        
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

    // Initialize dropdowns when DOM loads
    document.addEventListener('DOMContentLoaded', () => {
        const selectors = document.querySelectorAll('.tts-lang-select');
        selectors.forEach(sel => {
            sel.value = selectedLanguage;
            sel.addEventListener('change', (e) => {
                setLanguagePreference(e.target.value);
            });
        });
    });

    // Expose global methods
    window.speakReport = speakReport;
    window.speakTagalogReport = speakTagalogReport;
    window.stopSpeech = stopSpeech;
    window.setLanguagePreference = setLanguagePreference;
})();
