// popup.js

// --- Configuration Flags ---
//const USER_ALONE = false; // Set to false to hide certain elements, true to show all
//const USE_STORED_LLM_RESPONSE = false; // Set to true to use stored LLM responses from posts.json instead of calling the local LLM model

document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const contextStatusDiv = document.getElementById('contextStatus');
    const extractedTextArea = document.getElementById('extractedText');
    const resultContainer = document.getElementById('result-container');
    const resultDiv = document.getElementById('result');
    const conclusionContainer = document.getElementById('conclusion-container');
    const conclusionText = document.getElementById('conclusion-text');

    const captureContextBtn = document.getElementById('captureContextBtn');
    const extractTextBtn = document.getElementById('extractTextBtn');
    const evaluateBtn = document.getElementById('evaluateBtn');
    const modelSelector = document.getElementById('modelSelector');
    const debugModeCheckbox = document.getElementById('debugModeCheckbox');
    const useStoredLLMCheckbox = document.getElementById('useStoredLLMCheckbox');
    const userAloneCheckbox = document.getElementById('userAloneCheckbox');
    const resetContextBtn = document.getElementById('resetContextBtn'); // NEW

    const createTabsBtn = document.getElementById('createTabs');
    const startBtn = document.getElementById('startBtn');
    const startContainer = document.getElementById('startContainer');
    const mainContent = document.getElementById('mainContent');
    const confidenceSection = document.getElementById('confidence-section');
    const judgementSection = document.getElementById('judgement-section');
    const confirmSection = document.getElementById('confirm-section');
    const confidenceRadios = document.querySelectorAll('input[name="confidenceRadio"]');
    const judgementRadios = document.querySelectorAll('input[name="aiJudgement"]');
    const confirmFeedbackBtn = document.getElementById('confirmFeedbackBtn');
    const modelSelectorContainer = document.querySelector('.model-selector-container');
    const aiDetectorHeader = document.getElementById('ai-detector-header');
    const debugCheckboxes = document.getElementById('debug-checkboxes');
    const storedLLMCheckbox = document.getElementById('stored-llm-checkbox');
    const userAloneCheckboxContainer = document.getElementById('user-alone-checkbox');

    let aiDisplayTime = null;
    let evaluationAttemptId = 0; // Tracks number of times same text is evaluated (for re-evaluation detection)
    let lastEvaluatedText = "";
    let selectedConfidence = null; // Track if user has selected confidence
    let selectedJudgement = null;
    let lastLoggedEventType = null; // Track the last logged event type to avoid spam

    // --- Main Actions ---

    createTabsBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createTabs" });
    });
    // --- Check if createTabsBtn and the checkboxes should be visible ---
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            const currentUrl = tabs[0].url;
            // Hide button if on non-allowed sites
            const nonAllowedPatterns = ['https://www.reddit.com/*', 'https://x.com/*', 'https://www.jeuxvideo.com/*'];
            const isAllowed = nonAllowedPatterns.every(pattern => {
                const regexPattern = pattern.replace(/\*/g, '.*');
                return !new RegExp(`^${regexPattern}$`).test(currentUrl);
            });
            createTabsBtn.hidden = !isAllowed;
            
            // Hide checkboxes on Reddit/X.com (same logic as createTabs)
            debugCheckboxes.style.display = isAllowed ? 'block' : 'none';
            storedLLMCheckbox.style.display = isAllowed ? 'block' : 'none';
            userAloneCheckboxContainer.style.display = isAllowed ? 'block' : 'none';
            
            // Show Start button only on specific sites (opposite of createTabs logic)
            const shouldShowStart = !isAllowed;
            
            // Check if this page was already started
            chrome.storage.local.get('startedPages', (result) => {
                const startedPages = result.startedPages || {};
                const pageWasStarted = startedPages[currentUrl] === true;
                
                if (shouldShowStart && !pageWasStarted) {
                    // Show start container, hide main content initially
                    startContainer.style.display = 'block';
                    mainContent.style.display = 'none';
                } else {
                    // Either not a Start-required site, or was already started
                    startContainer.style.display = 'none';
                    mainContent.style.display = 'block';
                    confidenceSection.style.display = 'block';
                    judgementSection.style.display = 'block';
                    confirmSection.style.display = 'block';
                }
            });
        }
    });
    
    // --- Start button handler ---
    startBtn.addEventListener('click', () => {
        startContainer.style.display = 'none';
        mainContent.style.display = 'block';
        
        // Show confidence and judgement sections when starting
        confidenceSection.style.display = 'block';
        judgementSection.style.display = 'block';
        confirmSection.style.display = 'block';
        
        // Get current tab and set up trial_id and post URL
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            console.log("Tabs queried for start button:", tabs);
            if (tabs[0]) {
                const currentUrl = tabs[0].url;
                
                // Set up trial_id and post URL
                chrome.storage.local.get(['nextTrialId', 'startedPages', 'aiGeneratedByTab'], (result) => {
                    const nextTrialId = result.nextTrialId ?? 0;
                    const startedPages = result.startedPages || {};
                    const aiGeneratedByTab = result.aiGeneratedByTab || {};
                    const tabId = tabs[0].id;
                    const aiGenerated = aiGeneratedByTab[tabId]?.ai_generated_post;
                    
                    // Save current trial info
                    chrome.storage.local.set({
                        currentTrialId: nextTrialId,
                        currentPostUrl: currentUrl,
                        isAIGeneratedPost: typeof aiGenerated === 'boolean' ? aiGenerated : null,
                        nextTrialId: nextTrialId + 1,
                        startedPages: { ...startedPages, [currentUrl]: true }
                    });
                    
                    // DEBUG: Log the trial_id and post URL
                    console.log(`[START BUTTON] Trial ID: ${nextTrialId}, Post URL: ${currentUrl}`);
                    
                    // Log the "start" event
                    sendLog("start");
                });
            }
        });
    });

    captureContextBtn.addEventListener('click', () => {
        startSelection('context', 'Select the context area...');
    });

    extractTextBtn.addEventListener('click', () => {
        startSelection('text', 'Select the text area to extract...');
    });

    // Add a listener for manual edits (with a small delay to avoid spamming)
    let typingTimer;
    extractedTextArea.addEventListener('input', () => {
        evaluateBtn.disabled = extractedTextArea.value.trim() === '';
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            // Only log if the last logged event was NOT manual_text_edit (to avoid spam)
            if (lastLoggedEventType !== 'manual_text_edit') {
                sendLog("manual_text_edit");
                lastLoggedEventType = 'manual_text_edit';
            }
        }, 1000);
    });

    evaluateBtn.addEventListener('click', () => {
        const text = extractedTextArea.value;
        if (text === lastEvaluatedText) {
            evaluationAttemptId++;
        } else {
            evaluationAttemptId = 0;
            lastEvaluatedText = text;
        }
        // Reset timer; will start when results are displayed
        aiDisplayTime = null;
        
        // Log evaluate_clicked with the extracted text
        sendLog("evaluate_clicked", { extracted_text: text });

        // Clear previous selection state
        selectedConfidence = null;
        selectedJudgement = null;
        confidenceRadios.forEach(r => { r.checked = false; });
        judgementRadios.forEach(r => { r.checked = false; });

        resultContainer.className = ''; // Clear previous result styling
        chrome.runtime.sendMessage({ action: "evaluate", text: extractedTextArea.value });
    });

    resetContextBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "resetContext" });
    });

    extractedTextArea.addEventListener('input', () => {
        evaluateBtn.disabled = extractedTextArea.value.trim() === '';
    });

    modelSelector.addEventListener('change', () => {
        chrome.storage.local.set({ selectedModel: modelSelector.value });
    });

    debugModeCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ debugMode: debugModeCheckbox.checked });
    });

    useStoredLLMCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ useStoredLLMResponse: useStoredLLMCheckbox.checked });
    });

    userAloneCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ userAlone: userAloneCheckbox.checked });
//        // Update UI immediately to reflect the change
//        chrome.runtime.sendMessage({ action: "getInitialState" });
    });
    
    function startSelection(type, statusMessage) {
        statusDiv.textContent = `Status: ${statusMessage}`;
        chrome.runtime.sendMessage({ action: "startSelection", type: type });
        window.close();
    }

    // --- Listen for Updates from Background ---

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "updateStatus") {
            statusDiv.textContent = `Status: ${request.message}`;
        }
        if (request.action === "updateUI") {
            updateUIState(request.data);
        }
        if (request.action === "updateLogCount") {
            document.getElementById('logCount').textContent = `Logs: ${request.count}`;
        }
    });

    function updateUIState(data) {
        console.log("Updating UI with data:", data);
        const converter = new showdown.Converter();
        
        // State variables
        const isProcessing = data.isProcessing ?? false;
        const errorMessage = data.errorMessage ?? null;
        const hasContext = !!data.contextImageDataUrl;
        const hasText = !!data.extractedText && data.extractedText.trim() !== '';

        // --- 1. Handle Processing and Error States First ---
        statusDiv.classList.remove('status-error');
        if (isProcessing) {
            statusDiv.textContent = 'Status: Processing with Ollama...';
            // Disable everything while processing
            captureContextBtn.disabled = true;
            extractTextBtn.disabled = true;
            evaluateBtn.disabled = true;
            resetContextBtn.disabled = true;
        } else if (errorMessage) {
            statusDiv.textContent = `Error: ${errorMessage}`;
            statusDiv.classList.add('status-error');
            // Re-enable capture button so user can try again
            captureContextBtn.disabled = false;
            extractTextBtn.disabled = false;
        } else {
            statusDiv.textContent = 'Status: Ready.';
            // Enable buttons based on logic below
            captureContextBtn.disabled = false;
            extractTextBtn.disabled = false;
        }

        // --- 2. Update General UI Elements ---
        debugModeCheckbox.checked = data.debugMode ?? false;
        useStoredLLMCheckbox.checked = data.useStoredLLMResponse ?? false;
        userAloneCheckbox.checked = data.userAlone ?? false;
        modelSelector.value = data.selectedModel || 'gemma3';

        // --- 2b. Update visibility based on USER_ALONE ---
        const userAloneEnabled = data.userAlone ?? false;
        if (userAloneEnabled) {
            document.getElementById('step-capture').style.display = 'none';
            document.getElementById('step-extract').style.display = 'none';
            document.getElementById('step-evaluate').style.display = 'none';
            if (modelSelectorContainer) modelSelectorContainer.style.display = 'none';
            if (aiDetectorHeader) aiDetectorHeader.style.display = 'none';
        } else {
            document.getElementById('step-capture').style.display = 'block';
            document.getElementById('step-extract').style.display = 'block';
            document.getElementById('step-evaluate').style.display = 'block';
            if (modelSelectorContainer) modelSelectorContainer.style.display = 'block';
            if (aiDetectorHeader) aiDetectorHeader.style.display = 'block';
        }

        // --- 3. Update Context-related UI ---
        if (hasContext) {
            contextStatusDiv.textContent = 'Context captured';
            resetContextBtn.hidden = false;
            resetContextBtn.disabled = isProcessing;
        } else {
            contextStatusDiv.textContent = 'Not captured';
            resetContextBtn.hidden = true;
        }
        
        // --- 4. Update Text and Evaluation UI ---
        if (data.extractedText) {
            extractedTextArea.value = data.extractedText;
        }
        evaluateBtn.disabled = isProcessing || !hasContext || !hasText;

        // --- 5. Update Result Display ---
        resultContainer.className = '';
        if (data.evaluationResult) {
            // Start decision timer when results are first displayed
            if (!aiDisplayTime) {
                aiDisplayTime = Date.now();
            }
            
            if (data.evaluationResult.startsWith('[ERROR]')) {
                const errorMsg = data.evaluationResult.replace('[ERROR]', '');
                resultDiv.innerHTML = `<p>${errorMsg}</p>`;
                resultContainer.classList.add('result-error');
                conclusionContainer.style.display = 'none';
            } else {
                const probMatch = data.evaluationResult.match(/\[PROB:(.*?)\]/);
                const markdownContent = data.evaluationResult.replace(/\[PROB:.*?\]/, '');
                
                let scoreHtml = '';
                let probability = 0.5;

                if (probMatch && probMatch[1]) {
                    probability = parseFloat(probMatch[1]);
                    // Determine decision label based on probability
                    let decisionLabel = 'unsure';
                    if (probability > 0.5) {
                        decisionLabel = 'AI Post';
                    } else if (probability < 0.5) {
                        decisionLabel = 'Human Post';
                    }
                    // Determine uncertainty badge
                    let uncertainty = 'low';
                    if (probability >= 0.4 && probability <= 0.6) {
                        uncertainty = 'high';
                    } else if ((probability >= 0.2 && probability <= 0.4) || (probability >= 0.6 && probability <= 0.8)) {
                        uncertainty = 'medium';
                    }
                    scoreHtml = `<div class=\"score-header\" data-prob=\"${probability}\"><span class=\"decision-label\"><strong>${decisionLabel}</strong></span><span class=\"uncertainty-badge uncertainty-${uncertainty}\">Uncertainty: <strong>${uncertainty}</strong></span></div>`;
                }

                const reasonHtml = converter.makeHtml(markdownContent);
                resultDiv.innerHTML = scoreHtml + reasonHtml;
                
                // Display conclusion if available
                if (data.evaluationConclusion && data.evaluationConclusion.trim() !== '') {
                    conclusionText.textContent = data.evaluationConclusion;
                    conclusionContainer.style.display = 'block';
                } else {
                    conclusionContainer.style.display = 'none';
                }
                
                if (probability > 0.5) {
                    resultContainer.classList.add('result-ai');
                } else if (probability < 0.5) {
                    resultContainer.classList.add('result-human');
                } else {
                    // Exactly 0.5 -> unsure
                    resultContainer.classList.add('result-unknown');
                }
            }
        } else {
            resultDiv.textContent = '';
            conclusionContainer.style.display = 'none';
        }

        // update log count
        chrome.storage.local.get('logs', (res) => {
            if (res.logs) {
                document.getElementById('logCount').textContent = `Logs: ${res.logs.length}`;
            }
        });

    }

    // --- NEW LOGGING SYSTEM ---
    // Helper to send logs with new field structure
    function sendLog(eventType, additionalFields = {}) {
        // Update the last logged event type (unless it's manual_text_edit, which updates itself)
        if (eventType !== 'manual_text_edit') {
            lastLoggedEventType = eventType;
        }
        
        // Retrieve trial_id from storage instead of using local variable
        chrome.storage.local.get('currentTrialId', (result) => {
            chrome.runtime.sendMessage({
                action: "logEntry",
                data: {
                    event_type: eventType,
                    model_used: modelSelector.value,
                    trial_id: result.currentTrialId ?? null,
                    
                    // Include any additional fields specific to this log event
                    ...additionalFields
                }
            });
        });
    }

    // Capture radio selections
    confidenceRadios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedConfidence = parseInt(e.target.value, 10);
        });
    });

    judgementRadios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedJudgement = e.target.value;
        });
    });

    // Confirm button submits combined feedback
    confirmFeedbackBtn.addEventListener('click', () => {
        if (selectedConfidence === null || selectedJudgement === null) {
            alert('Please select confidence and AI judgement before confirming.');
            return;
        }

        // Compute decision_time_ms from when LLM result was displayed
        const decisionTimeMs = aiDisplayTime ? Date.now() - aiDisplayTime : null;

        // Normalize confidence to 0.0 - 1.0
        const userConfidence = selectedConfidence !== null ? selectedConfidence / 100 : null;
        const userDecision = selectedJudgement === 'yes' ? 'Yes' : 'No';

        // Determine AI suggested decision from probability
        const probability = extractScoreFromUI(); // 0-1 or null
        let userAction = 'ignore';
        if (probability !== null && !Number.isNaN(probability)) {
            if (probability === 0.5) {
                userAction = 'ignore';
            } else {
                const aiSuggestsYes = probability > 0.5;
                const userYes = selectedJudgement === 'yes';
                userAction = (aiSuggestsYes === userYes) ? 'accept' : 'refuse';
            }
        }

        // Fetch ai_generated_post to compute correctness
        chrome.storage.local.get('isAIGeneratedPost', (res) => {
            const aiGenerated = res.isAIGeneratedPost;
            let correct = null;
            if (typeof aiGenerated === 'boolean') {
                const userThinksAI = selectedJudgement === 'yes';
                correct = (userThinksAI === aiGenerated) ? 'YES' : 'NO';
            }

            sendLog('decision', {
                user_confidence: userConfidence,
                user_decision: userDecision,
                decision_time_ms: decisionTimeMs,
                user_action: userAction,
                correct: correct,
                extracted_text: extractedTextArea.value
            });
        });

        chrome.runtime.sendMessage({ action: "confidenceSubmitted" });

        // Reset selections
        selectedConfidence = null;
        selectedJudgement = null;
        confidenceRadios.forEach(r => { r.checked = false; });
        judgementRadios.forEach(r => { r.checked = false; });

        // Hide all UI elements except the thank-you message
        const mainContent = document.getElementById('mainContent');
        if (mainContent) {
            mainContent.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'thank-you';
            msg.textContent = 'Thank you, you can continue with the next tab';
            mainContent.appendChild(msg);
        }
    });

    function extractScoreFromUI() {
        const header = document.querySelector('.score-header');
        const probAttr = header ? header.getAttribute('data-prob') : null;
        return probAttr ? parseFloat(probAttr) : null;
    }

    // Log management buttons
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        if(confirm("Delete all logs?")) {
            chrome.storage.local.set({ logs: [] }, () => {
                document.getElementById('logCount').textContent = "Logs: 0";
            });
        }
    });

    document.getElementById('downloadLogsBtn').addEventListener('click', async () => {
        const { logs = [] } = await chrome.storage.local.get('logs');
        if (logs.length === 0) return alert("No logs to download");

        // NEW CSV HEADERS - Updated to match new log structure
        const headers = [
            "timestamp", "event_type", "session_id", "trial_id", "post", 
            "condition", "model_used", "ai_generated_post",
            "user_confidence", "user_decision", "decision_time_ms", 
            "user_action", "correct",
            "ai_output_probability", "ai_output_response", "ai_output_conclusion", "ai_uncertainty",
            "extracted_text", "capture_name", "notes"
        ];
        
        const csvContent = [
            headers.join(","),
            ...logs.map(row => headers.map(fieldName => {
                let val = row[fieldName] ?? "";
                return `"${String(val).replace(/"/g, '""')}"`; // Escape for CSV
            }).join(","))
        ].join("\r\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `ai_detector_logs_${new Date().getTime()}.csv`
            });
    });

    // --- Hide elements when USER_ALONE is true ---
    chrome.storage.local.get('userAlone', (result) => {
        const userAloneEnabled = result.userAlone ?? false;
        if (userAloneEnabled) {
            document.getElementById('step-capture').style.display = 'none';
            document.getElementById('step-extract').style.display = 'none';
            document.getElementById('step-evaluate').style.display = 'none';
            if (modelSelectorContainer) modelSelectorContainer.style.display = 'none';
            if (aiDetectorHeader) aiDetectorHeader.style.display = 'none';
        }
    });
    
    // Show confidence and judgement sections if we're already past the start screen
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            const currentUrl = tabs[0].url;
            const nonAllowedPatterns = ['https://www.reddit.com/*', 'https://x.com/*', 'https://www.jeuxvideo.com/*'];
            const shouldShowStart = !nonAllowedPatterns.every(pattern => {
                const regexPattern = pattern.replace(/\*/g, '.*');
                return !new RegExp(`^${regexPattern}$`).test(currentUrl);
            });
            
            if (shouldShowStart) {
                // Check if page was already started
                chrome.storage.local.get('startedPages', (result) => {
                    const startedPages = result.startedPages || {};
                    if (startedPages[currentUrl]) {
                        // Page was started, show sections
                        confidenceSection.style.display = 'block';
                        judgementSection.style.display = 'block';
                        confirmSection.style.display = 'block';
                    }
                });
            } else {
                // Not a start-required site, show sections immediately
                confidenceSection.style.display = 'block';
                judgementSection.style.display = 'block';
                confirmSection.style.display = 'block';
            }
        }
    });

    // --- Restore State on Popup Open ---
    chrome.runtime.sendMessage({ action: "getInitialState" });
    
    // DEBUG: Log current trial_id and post URL on popup open
    chrome.storage.local.get(['currentTrialId', 'currentPostUrl'], (result) => {
        console.log("[POPUP OPEN] Current Trial ID:", result.currentTrialId ?? 'not set', "Post URL:", result.currentPostUrl ?? 'not set');
    });
});