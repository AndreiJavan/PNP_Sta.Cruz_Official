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

    let googleTTSActive = false;

    function splitTextIntoChunks(text, maxLength) {
        const chunks = [];
        const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+/g) || [text];
        
        let currentChunk = "";
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxLength) {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }
                if (sentence.length > maxLength) {
                    // Force split long sentence by words
                    const words = sentence.split(/\s+/);
                    let subChunk = "";
                    for (const word of words) {
                        if ((subChunk + " " + word).length > maxLength) {
                            if (subChunk.trim()) chunks.push(subChunk.trim());
                            subChunk = word;
                        } else {
                            subChunk += (subChunk ? " " : "") + word;
                        }
                    }
                    currentChunk = subChunk;
                } else {
                    currentChunk = sentence;
                }
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
            }
        }
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        return chunks;
    }

    function playGoogleTTS(text, lang) {
        return new Promise((resolve, reject) => {
            googleTTSActive = true;
            const chunks = splitTextIntoChunks(text, 180);
            if (chunks.length === 0) {
                googleTTSActive = false;
                reject(new Error("No text to speak"));
                return;
            }
            
            let currentIndex = 0;
            
            function playNext() {
                if (!googleTTSActive) {
                    resolve();
                    return;
                }
                if (currentIndex >= chunks.length) {
                    googleTTSActive = false;
                    resolve();
                    return;
                }
                
                const chunk = chunks[currentIndex];
                const requestLang = lang === 'fil-PH' ? 'tl' : lang;
                const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${requestLang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
                
                const audio = new Audio(url);
                currentAudio = audio;
                
                audio.onended = () => {
                    if (googleTTSActive) {
                        currentIndex++;
                        playNext();
                    }
                };
                
                audio.onerror = (e) => {
                    googleTTSActive = false;
                    reject(e);
                };
                
                audio.play().catch(err => {
                    googleTTSActive = false;
                    reject(err);
                });
            }
            
            playNext();
        });
    }

    async function speakReport(btnId, text, langOverride) {
        if (!text || !text.trim()) return;

        const btn = document.getElementById(btnId);
        let voiceType = 'google';
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
                        voiceType = 'google';
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

        if (voiceType === 'native') {
            fallbackNativeSpeech(speechTextToPlay, null, voiceValue);
        } else {
            try {
                if (btn) {
                    btn.classList.remove('loading');
                    btn.classList.add('speaking');
                    btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
                }
                await playGoogleTTS(speechTextToPlay, targetLanguage);
                resetActiveButton();
            } catch (error) {
                console.warn('Google TTS failed, trying native Web Speech API fallback:', error);
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
            if (btn) {
                btn.classList.remove('loading');
                btn.classList.add('speaking');
                btn.innerHTML = `<i class="fas fa-stop text-xs text-red-400"></i><span>Stop</span>`;
            }
            await playGoogleTTS(cleanText, 'fil-PH');
            resetActiveButton();
        } catch (error) {
            console.warn('Google Tagalog TTS failed, trying native Web Speech API fallback:', error);
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
        googleTTSActive = false;
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

            // Simple dropdown with premium Google Tagalog and English options
            let optionsHtml = `
                <option value="google:fil-PH">Tagalog / Filipino</option>
                <option value="google:en-US">English (US)</option>
            `;

            select.innerHTML = optionsHtml;

            if (currentSelected && (currentSelected.includes('fil-PH') || currentSelected.includes('en-US'))) {
                select.value = currentSelected.includes('fil-PH') ? 'google:fil-PH' : 'google:en-US';
            } else {
                select.value = 'google:fil-PH';
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

            const translateTextHelper = async (textToTranslate) => {
                if (!textToTranslate || !textToTranslate.trim()) return textToTranslate;
                
                // 1. Try server-side translator first
                try {
                    const res = await fetch('/api/translate-tagalog', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: textToTranslate })
                    }).then(r => r.json());
                    if (res.success && res.tagalogText && res.tagalogText.trim() !== textToTranslate.trim()) {
                        return res.tagalogText;
                    }
                } catch (e) {
                    console.warn('Server translation failed, trying fallback:', e);
                }

                // 2. Try free client-side MyMemory API fallback (supports chunked requests for long news articles)
                try {
                    const textChunks = splitTextIntoChunks(textToTranslate, 450);
                    const translatedChunks = await Promise.all(textChunks.map(async (chunk) => {
                        try {
                            const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|tl`);
                            const data = await response.json();
                            if (data && data.responseData && data.responseData.translatedText && !data.responseData.translatedText.includes('QUERY LENGTH LIMIT EXCEEDED')) {
                                return data.responseData.translatedText;
                            }
                        } catch (err) {}
                        return chunk;
                    }));
                    const combined = translatedChunks.join(' ');
                    if (combined.trim() !== textToTranslate.trim() && !combined.includes('QUERY LENGTH LIMIT EXCEEDED')) {
                        return combined;
                    }
                } catch (e) {
                    console.warn('MyMemory translation failed:', e);
                }

                // 3. Try client-side Puter AI fallback
                if (typeof puter !== 'undefined' && puter.ai) {
                    try {
                        const prompt = `Translate the following text into clear, natural, official Tagalog (Filipino). Return ONLY the translated Tagalog text, with no explanations, notes, or extra formatting:\n\n${textToTranslate}`;
                        const response = await puter.ai.chat(prompt);
                        if (response && response.trim()) {
                            return response.trim();
                        }
                    } catch (e) {
                        console.warn('Puter AI chat translation failed:', e);
                    }
                }
                return textToTranslate;
            };

            try {
                const translatedTitle = await translateTextHelper(titleEl.textContent);
                const translatedContent = await translateTextHelper(contentEl.textContent);

                titleEl.textContent = translatedTitle;
                contentEl.textContent = translatedContent;

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
