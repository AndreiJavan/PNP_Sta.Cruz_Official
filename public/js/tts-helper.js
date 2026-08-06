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

    async function speakReport(btnId, text, langOverride) {
        if (!text || !text.trim()) return;

        const btn = document.getElementById(btnId);
        let voiceType = 'puter';
        let voiceValue = langOverride || getSelectedLanguage();
        let targetLanguage = 'en-US';

        if (voiceValue === 'fil-PH') {
            targetLanguage = 'fil-PH';
        }

        if (btn) {
            const container = btn.closest('.relative') || btn.parentElement;
            const selector = container ? container.querySelector('.tts-voice-select') : document.querySelector('.tts-voice-select');
            if (selector && selector.value) {
                const val = selector.value;
                if (val.startsWith('native:')) {
                    voiceType = 'native';
                    voiceValue = val.replace('native:', '');
                    targetLanguage = getSelectedLanguage() === 'fil-PH' ? 'fil-PH' : 'en-US';
                } else {
                    const parts = val.split(':');
                    if (parts.length >= 3) {
                        voiceType = parts[0];
                        voiceValue = parts[1];
                        targetLanguage = parts[2];
                    } else if (parts.length === 2) {
                        voiceType = parts[0];
                        voiceValue = parts[1];
                        targetLanguage = parts[1] === 'fil-PH' ? 'fil-PH' : 'en-US';
                    } else {
                        voiceType = 'puter';
                        voiceValue = val;
                        targetLanguage = val === 'fil-PH' ? 'fil-PH' : 'en-US';
                    }
                }
            }
        }

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
        let speechTextToPlay = cleanText;

        // Ensure browser compatibility shim for crypto.createHash if referenced internally by third-party libs
        if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.createHash !== 'function') {
            try {
                window.crypto.createHash = function () {
                    return {
                        update: function () { return this; },
                        digest: function () { return '00000000000000000000000000000000'; }
                    };
                };
            } catch (e) { }
        }

        if (voiceType === 'native') {
            fallbackNativeSpeech(speechTextToPlay, null, voiceValue);
        } else {
            // Use Puter.js Text-to-Speech
            try {
                if (typeof puter !== 'undefined' && puter.ai) {
                    let audio;
                    if (voiceType === 'openai') {
                        audio = await puter.ai.txt2speech(speechTextToPlay, {
                            provider: 'openai',
                            model: 'tts-1',
                            voice: voiceValue
                        });
                    } else if (voiceType === 'polly') {
                        audio = await puter.ai.txt2speech(speechTextToPlay, {
                            provider: 'aws-polly',
                            voice: voiceValue,
                            language: targetLanguage
                        });
                    } else if (voiceType === 'elevenlabs') {
                        audio = await puter.ai.txt2speech(speechTextToPlay, {
                            provider: 'elevenlabs',
                            voice: voiceValue
                        });
                    } else {
                        audio = await puter.ai.txt2speech(speechTextToPlay, voiceValue);
                    }
                    currentAudio = audio;

                    audio.onended = () => {
                        resetActiveButton();
                    };

                    audio.onerror = () => {
                        resetActiveButton();
                    };

                    if (activeBtnId) {
                        if (btn) {
                            btn.classList.remove('loading');
                            btn.classList.add('speaking');
                            btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
                        }
                    }

                    audio.play();
                } else {
                    fallbackNativeSpeech(speechTextToPlay, targetLanguage);
                }
            } catch (error) {
                console.error('Puter TTS error:', error);
                fallbackNativeSpeech(speechTextToPlay, targetLanguage);
            }
        }
    }

    async function speakTagalogReport(btnId, text) {
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
            btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xs"></i><span>Loading Audio...</span>`;
        }

        const cleanText = text.replace(/<[^>]*>/g, '').trim();

        try {
            if (typeof puter !== 'undefined' && puter.ai) {
                const audio = await puter.ai.txt2speech(cleanText, 'fil-PH');
                currentAudio = audio;

                audio.onended = () => {
                    resetActiveButton();
                };

                audio.onerror = () => {
                    resetActiveButton();
                };

                if (activeBtnId) {
                    if (btn) {
                        btn.classList.remove('loading');
                        btn.classList.add('speaking');
                        btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
                    }
                }

                audio.play();
            } else {
                fallbackNativeSpeech(cleanText, 'fil-PH');
            }
        } catch (error) {
            console.error('Puter TTS error:', error);
            fallbackNativeSpeech(cleanText, 'fil-PH');
        }
    }

    function fallbackNativeSpeech(cleanText, lang, voiceName) {
        if (!('speechSynthesis' in window)) {
            alert('Text-to-speech is not supported in this browser.');
            resetActiveButton();
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);

        if (voiceName) {
            const voices = window.speechSynthesis.getVoices();
            const selectedVoice = voices.find(v => v.name === voiceName);
            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }
        } else if (lang) {
            utterance.lang = lang;
        } else {
            utterance.lang = 'en-US';
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
            } catch (e) { }
            currentAudio = null;
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        resetActiveButton();
    }

    function populateVoiceSelectors() {
        const selectors = document.querySelectorAll('.tts-voice-select');
        if (selectors.length === 0) return;

        selectors.forEach(select => {
            const currentSelected = select.value;

            // Simple dropdown with premium OpenAI Tagalog and English options
            let optionsHtml = `
                <option value="openai:nova:fil-PH">Tagalog / Filipino</option>
                <option value="openai:nova:en-US">English (US)</option>
            `;

            select.innerHTML = optionsHtml;

            if (currentSelected && (currentSelected === 'openai:nova:fil-PH' || currentSelected === 'openai:nova:en-US')) {
                select.value = currentSelected;
            } else {
                select.value = 'openai:nova:fil-PH';
            }
        });
    }

    // Initialize dropdowns when DOM loads or voices change
    document.addEventListener('DOMContentLoaded', () => {
        populateVoiceSelectors();

        const selectors = document.querySelectorAll('.tts-lang-select');
        selectors.forEach(sel => {
            sel.value = selectedLanguage;
            sel.addEventListener('change', (e) => {
                setLanguagePreference(e.target.value);
            });
        });
    });

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = populateVoiceSelectors;
    }

    async function toggleTranslation(btnId, titleElId, contentElId, ttsBtnId) {
        const btn = document.getElementById(btnId);
        const titleEl = document.getElementById(titleElId);
        const contentEl = document.getElementById(contentElId);
        const ttsBtn = document.getElementById(ttsBtnId);

        if (!btn || !titleEl || !contentEl) return;

        const isTranslated = btn.dataset.translated === 'true';

        if (!isTranslated) {
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.dataset.originalHtml = originalHtml;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin text-sm"></i><span>Translating...</span>`;

            btn.dataset.origTitle = titleEl.textContent;
            btn.dataset.origContent = contentEl.textContent;

            try {
                const titleRes = await fetch('/api/translate-tagalog', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: titleEl.textContent })
                }).then(r => r.json());

                const contentRes = await fetch('/api/translate-tagalog', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: contentEl.textContent })
                }).then(r => r.json());

                if (titleRes.success && titleRes.tagalogText) {
                    titleEl.textContent = titleRes.tagalogText;
                }
                if (contentRes.success && contentRes.tagalogText) {
                    contentEl.textContent = contentRes.tagalogText;
                }

                btn.dataset.translated = 'true';
                btn.innerHTML = `<i class="fas fa-undo text-sm"></i><span>Show Original</span>`;

                if (ttsBtn) {
                    const newSpeechText = `${titleEl.textContent}. ${contentEl.textContent}`;
                    ttsBtn.onclick = () => speakReport(ttsBtnId, newSpeechText);
                }
            } catch (err) {
                console.error('Translation error:', err);
                btn.innerHTML = originalHtml;
            } finally {
                btn.disabled = false;
            }
        } else {
            titleEl.textContent = btn.dataset.origTitle || titleEl.textContent;
            contentEl.textContent = btn.dataset.origContent || contentEl.textContent;

            btn.dataset.translated = 'false';
            btn.innerHTML = `<i class="fas fa-language text-sm"></i><span>Translate</span>`;

            if (ttsBtn) {
                const origSpeechText = `${titleEl.textContent}. ${contentEl.textContent}`;
                ttsBtn.onclick = () => speakReport(ttsBtnId, origSpeechText);
            }
        }
    }

    function resetTranslationButton(btnId, titleElId, contentElId, originalTitle, originalContent, ttsBtnId) {
        const btn = document.getElementById(btnId);
        const titleEl = document.getElementById(titleElId);
        const contentEl = document.getElementById(contentElId);
        const ttsBtn = document.getElementById(ttsBtnId);

        if (btn) {
            btn.dataset.translated = 'false';
            btn.innerHTML = `<i class="fas fa-language text-sm"></i><span>Translate</span>`;
            btn.dataset.origTitle = originalTitle;
            btn.dataset.origContent = originalContent;
        }

        if (titleEl && originalTitle) {
            titleEl.textContent = originalTitle;
        }
        if (contentEl && originalContent) {
            contentEl.textContent = originalContent;
        }

        if (ttsBtn && originalTitle && originalContent) {
            const origSpeechText = `${originalTitle}. ${originalContent}`;
            ttsBtn.onclick = () => speakReport(ttsBtnId, origSpeechText);
        }
    }

    // Expose global methods
    window.speakReport = speakReport;
    window.speakTagalogReport = speakTagalogReport;
    window.stopSpeech = stopSpeech;
    window.setLanguagePreference = setLanguagePreference;
    window.populateVoiceSelectors = populateVoiceSelectors;
    window.toggleTranslation = toggleTranslation;
    window.resetTranslationButton = resetTranslationButton;
})();
