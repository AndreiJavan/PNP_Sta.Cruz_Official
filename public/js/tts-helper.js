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

        if (btn) {
            const container = btn.closest('.relative') || btn.parentElement;
            const selector = container ? container.querySelector('.tts-voice-select') : document.querySelector('.tts-voice-select');
            if (selector && selector.value) {
                const parts = selector.value.split(':');
                voiceType = parts[0];
                voiceValue = parts[1];
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

        if (voiceType === 'puter') {
            // Use Puter.js Text-to-Speech
            try {
                if (typeof puter !== 'undefined' && puter.ai) {
                    const audio = await puter.ai.txt2speech(cleanText, voiceValue);
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
                    fallbackNativeSpeech(cleanText, voiceValue);
                }
            } catch (error) {
                console.error('Puter TTS error:', error);
                fallbackNativeSpeech(cleanText, voiceValue);
            }
        } else if (voiceType === 'native') {
            fallbackNativeSpeech(cleanText, null, voiceValue);
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
            } catch (e) {}
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
            
            // Keep or initialize standard Puter options
            let optionsHtml = `
                <option value="puter:fil-PH">Puter AI - Tagalog</option>
                <option value="puter:en-US">Puter AI - English</option>
                <option value="puter:fr-FR">Puter AI - French</option>
                <option value="puter:de-DE">Puter AI - German</option>
                <option value="puter:es-ES">Puter AI - Spanish</option>
                <option value="puter:it-IT">Puter AI - Italian</option>
            `;
            
            select.innerHTML = optionsHtml;

            // Add native system voices
            if ('speechSynthesis' in window) {
                const voices = window.speechSynthesis.getVoices();
                voices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = `native:${voice.name}`;
                    option.textContent = `System - ${voice.name} (${voice.lang})`;
                    select.appendChild(option);
                });
            }

            if (currentSelected) {
                select.value = currentSelected;
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

    // Expose global methods
    window.speakReport = speakReport;
    window.speakTagalogReport = speakTagalogReport;
    window.stopSpeech = stopSpeech;
    window.setLanguagePreference = setLanguagePreference;
    window.populateVoiceSelectors = populateVoiceSelectors;
})();
