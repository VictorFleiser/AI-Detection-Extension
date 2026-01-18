console.log("background.js loaded");

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';
let lastTabUrl = null;
let currentSessionId = crypto.randomUUID();

// --- Helper function to get stored LLM response from posts.json ---
async function getStoredLLMResponse(pageUrl, isAI) {
    try {
        const response = await fetch(chrome.runtime.getURL('posts.json'));
        const posts = await response.json();
        const post = posts.find(p => p.urlMatch === pageUrl);
        if (post) {
            // Return the appropriate stored response based on whether post is AI or human
            if (isAI && post.storedLLMResponseAI) {
                return post.storedLLMResponseAI;
            } else if (!isAI && post.storedLLMResponseHuman) {
                return post.storedLLMResponseHuman;
            }
            // Fallback to legacy single response if new fields don't exist
            if (post.storedLLMResponse) {
                return post.storedLLMResponse;
            }
        }
    } catch (error) {
        console.error('Error fetching stored LLM response:', error);
    }
    return null;
}

chrome.runtime.onInstalled.addListener(() => {
  updateNetRequestRule();
});

// Listener to reset context on page navigation/reload ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // We only care when the tab has finished loading a new page
    if (changeInfo.status === 'complete') {
        currentSessionId = crypto.randomUUID(); // New session for new page
    }
    if (changeInfo.status === 'complete' && tab.url) {
        const { pageUrl } = await chrome.storage.local.get('pageUrl');
        // If the stored URL is different from the new tab URL, reset the context
        if (pageUrl && pageUrl !== tab.url) {
            console.log('URL changed, resetting context.');
            await chrome.storage.local.set({ 
                contextImageDataUrl: null, 
                pageUrl: null, 
                extractedText: null, 
                evaluationResult: null,
                evaluationConclusion: null
            });
            sendCurrentStateToPopup();
        }
        // Update the last known URL
        lastTabUrl = tab.url;
    }
});


function updateNetRequestRule() {
  const OLLAMA_RULE_ID = 1;
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [OLLAMA_RULE_ID],
    addRules: [
      {
        id: OLLAMA_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'remove' }
          ]
        },
        condition: {
          urlFilter: 'http://localhost:11434/api/generate',
          resourceTypes: ['xmlhttprequest']
        }
      }
    ]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to update declarativeNetRequest rules:', chrome.runtime.lastError);
    } else {
      console.log('DeclarativeNetRequest rule to remove Origin header for Ollama has been set.');
    }
  });
}


// --- Message Handling ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startSelection") {
        handleStartSelection(request.type);
    } 
    else if (request.action === "selectionComplete") {
        handleSelectionComplete(request, sender.tab);
    }
    else if (request.action === "croppedCaptureComplete") {
        handleCroppedCaptureComplete(request.type, request.dataUrl, request.url);
    }
    else if (request.action === "setAIGeneratedPost") {
        handleSetAIGeneratedPost(request, sender.tab);
    }
    else if (request.action === "evaluate") {
        handleEvaluation(request.text);
    } else if (request.action === "getInitialState") {
        sendCurrentStateToPopup();
    } 
    // --- NEW: Handler for manual context reset ---
    else if (request.action === "resetContext") {
        chrome.storage.local.set({ 
            contextImageDataUrl: null, 
            pageUrl: null,
            extractedText: null,
            evaluationResult: null,
            evaluationConclusion: null,
            awaitingConfidence: false
        }).then(() => {
            updateStatus("Context cleared.");
            sendCurrentStateToPopup();
        });
    } else if (request.action === "confidenceSubmitted") {
        chrome.storage.local.set({ awaitingConfidence: false }).then(() => {
            sendCurrentStateToPopup();
        });
    } else if (request.action === "logEntry") {
        saveLog(request.data);
        return false;// No response needed
    }
    return true; 
});

async function handleSetAIGeneratedPost(request, tab) {
    const tabId = tab?.id;
    if (!tabId) return;
    const { aiGeneratedByTab = {} } = await chrome.storage.local.get('aiGeneratedByTab');
    aiGeneratedByTab[tabId] = {
        ai_generated_post: request.aiGeneratedPost,
        postUrl: request.postUrl || tab.url || null
    };
    await chrome.storage.local.set({ aiGeneratedByTab });
}

// --- Action Handlers ---

async function handleStartSelection(type) {
    await chrome.storage.local.set({ errorMessage: null });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ["content.js"]
            }).then(() => {
                chrome.tabs.sendMessage(tabs[0].id, { action: "initiateSelection", type: type });
            });
        }
    });
}

async function handleSelectionComplete({ type, rect, devicePixelRatio }, tab) {
    try {
        await chrome.tabs.sendMessage(tab.id, { action: "cleanupSelectionUI" });
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise(resolve => setTimeout(resolve, 100));
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 100 });
        
        await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
        chrome.runtime.sendMessage({
            action: 'cropImage',
            type: type,
            dataUrl: dataUrl,
            rect: rect,
            devicePixelRatio: devicePixelRatio,
            url: tab.url
        });

    } catch (error) {
        console.error("Capture orchestration error:", error);
        updateStatus(`Error: ${error.message}`);
    }
}

async function handleCroppedCaptureComplete(type, dataUrl, url) {
    const { debugMode } = await chrome.storage.local.get('debugMode');
    
    if (debugMode) {
        await downloadImageForDebugging(dataUrl, type);
        // After successful download for context capture, log the capture_context event
        if (type === 'context') {
            const { captureName } = await chrome.storage.local.get('captureName');
            await saveLog({
                event_type: 'capture_context',
                capture_name: captureName || null
            });
            console.log("[CAPTURE_CONTEXT] Logged capture_context event with capture_name:", captureName);
        }
    }

    if (type === 'context') {
        updateStatus("Context image captured. Saving...");
        await chrome.storage.local.set({ contextImageDataUrl: dataUrl, pageUrl: url, extractedText: null, evaluationResult: null, evaluationConclusion: null });
        updateStatus("Context saved. Ready to extract text.");
    } else if (type === 'text') {
        updateStatus("Text image captured. Requesting text extraction...");
        
        // Log extract_text_initiated with capture_name (if debugMode was enabled and file was downloaded)
        const { captureName } = await chrome.storage.local.get('captureName');
        await saveLog({
            event_type: 'extract_text_initiated',
            capture_name: captureName || null
        });
        console.log("[EXTRACT_TEXT_INITIATED] Logged extract_text_initiated event with capture_name:", captureName);
        
        const prompt = "Extract the text from this image. Respond with only the text content, with no extra commentary or formatting.";
        const imageBase64 = dataUrl.split(',')[1];
        
        const { selectedModel } = await chrome.storage.local.get('selectedModel');
        const model = selectedModel || 'gemma3'; 
        
        callOllamaAPI('extractText', { model: model, prompt: prompt, images: [imageBase64], stream: false });
    }
    
    chrome.action.openPopup();
    sendCurrentStateToPopup();
}

// --- NEW LOGGING SYSTEM ---
// Updated to support the new log structure with all required fields
async function saveLog(entry) {
    const { logs = [] } = await chrome.storage.local.get('logs');
    
    // Get current state for context fields
    const state = await chrome.storage.local.get([
        'userAlone',
        'selectedModel',
        'currentPostUrl',
        'currentTrialId',
        'isAIGeneratedPost'
    ]);
    
    const newEntry = {
        timestamp: new Date().toISOString(),
        session_id: currentSessionId,
        event_type: entry.event_type || 'unknown',
        
        // Context fields (filled when available)
        trial_id: entry.trial_id ?? state.currentTrialId ?? null,
        post: entry.post ?? state.currentPostUrl ?? null,
        condition: state.userAlone ? 'User Alone' : 'User + AI',
        model_used: entry.model_used ?? state.selectedModel ?? null,
        ai_generated_post: entry.ai_generated_post ?? state.isAIGeneratedPost ?? null,
        
        // Include all additional fields from entry
        ...entry
    };
    
    logs.push(newEntry);
    await chrome.storage.local.set({ logs });
    console.log("[LOGGING] Event saved:", {
        event_type: newEntry.event_type,
        trial_id: newEntry.trial_id,
        post_url: newEntry.post,
        condition: newEntry.condition,
        model_used: newEntry.model_used,
        total_logs: logs.length
    });
    
    // Notify popup to refresh count
    chrome.runtime.sendMessage({ action: "updateLogCount", count: logs.length }).catch(() => {});
}

async function handleEvaluation(textToEvaluate) {
    await chrome.storage.local.set({ 
        extractedText: textToEvaluate, 
        errorMessage: null,
        awaitingConfidence: false // Clear flag when starting new evaluation
    });

    updateStatus("Evaluating text...");
    const { contextImageDataUrl, pageUrl } = await chrome.storage.local.get(["contextImageDataUrl", "pageUrl"]);

    // Check if USE_STORED_LLM_RESPONSE flag is enabled
    const useStoredResponse = (await chrome.storage.local.get('useStoredLLMResponse')).useStoredLLMResponse || false;
    if (useStoredResponse) {
        // Get the current tab to check if post is AI-generated
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const { aiGeneratedByTab = {} } = await chrome.storage.local.get('aiGeneratedByTab');
        const isAI = aiGeneratedByTab[activeTab?.id]?.ai_generated_post ?? false;
        
        const storedResponse = await getStoredLLMResponse(pageUrl, isAI);
        if (storedResponse) {
            updateStatus("Using stored LLM response...");
            await chrome.storage.local.set({ isProcessing: true });
            
            // Format the stored response to match what handleOllamaSuccess expects
            const formattedData = {
                response: JSON.stringify(storedResponse)
            };
            
            // Call handleOllamaSuccess with the stored response
            await handleOllamaSuccess(formattedData, 'evaluate');
            return;
        } else {
            updateStatus("Warning: No stored response found for this URL. Proceeding with local LLM.");
        }
    }

    if (!contextImageDataUrl) {
        updateStatus("Error: Cannot evaluate without a context image.");
        sendCurrentStateToPopup();
        return;
    }

    const prompt = `
Tu es un spécialiste de l’analyse de textes écrits. Ton objectif n’est pas de deviner l’origine du texte, mais de produire un « Rapport d’analyse du texte » clair et détaillé, basé uniquement sur des indices visibles dans l’écriture.

Tu dois analyser le texte comme le ferait un expert, mais en utilisant des termes compréhensibles par n’importe quel lecteur francophone, sans jargon technique.

### Ta mission :
1. Analyser le texte selon les trois dimensions suivantes :

   - **Variété et naturel de l’écriture**  
     (longueur et rythme des phrases, alternance entre phrases courtes et longues, impression de spontanéité)

   - **Prévisibilité du langage**  
     (choix des mots, formules attendues ou originales, impression de texte « générique » ou au contraire personnel)

   - **Présence d’une voix humaine**  
     (subjectivité, émotions, hésitations, style personnel, impression qu’une vraie personne s’exprime)

2. Résumer ces observations et attribuer un score final indiquant la probabilité que le texte ait été généré par une intelligence artificielle.

3. Répondre UNIQUEMENT avec un seul objet JSON valide contenant exactement les clés :
   - "analysis_report"
   - "final_score"

Aucun texte en dehors du JSON n’est autorisé.

---

### EXEMPLE 1 (Texte Humain)
**Contexte :** https://www.reddit.com/r/france/comments/exemple
**Texte à analyser :** "Honnêtement, je pense pas qu’on ait un rôle particulier à jouer. On est là, on vit, on fait ce qu’on peut avec ce qu’on a. Chercher un grand sens à tout ça, j’ai jamais trop compris l’intérêt. Perso, si j’arrive à être un minimum en paix avec moi-même, ça me va."
**Réponse attendue :**
\`\`\`json
{
  "analysis_report": "**Variété et naturel de l’écriture :** Le texte alterne entre phrases moyennes et phrases plus courtes, avec un rythme irrégulier qui évoque une réflexion spontanée. L’ensemble n’est pas excessivement structuré.\n**Prévisibilité du langage :** Le vocabulaire est simple mais personnel. Certaines formulations sont peu formelles et ne suivent pas un schéma attendu, ce qui rend le texte moins prévisible.\n**Présence d’une voix humaine :** Le texte exprime clairement une opinion personnelle, avec des nuances et une prise de distance. Le ton est réfléchi mais naturel, donnant l’impression d’un message écrit sans calcul particulier.",
  "final_score": {
    "probability": 0.2,
    "conclusion": "Le texte présente de forts indices d’une écriture humaine, notamment par son ton personnel, son rythme irrégulier et l’expression d’un point de vue nuancé."
  }
}
\`\`\`

---

### EXEMPLE 2 (Texte Généré par IA)
**Contexte :** https://www.reddit.com/r/france/comments/exemple
**Texte à analyser :** "Franchement, le sens de la vie, j’ai toujours trouvé que c’était une question un peu surcotée. On est là par hasard, on vit, puis voilà. Certains vont dire que le bonheur c’est la clé, mais au fond, dans quelques décennies, tout ça n’aura plus vraiment d’importance. Du coup, j’essaie juste de faire avec et de pas trop me prendre la tête."
**Réponse attendue :**
\`\`\`json
{
  "analysis_report": "**Variété et naturel de l’écriture :** Le texte adopte un rythme assez fluide, mais les phrases restent relativement homogènes dans leur construction. L’ensemble donne une impression de naturel maîtrisé.\n**Prévisibilité du langage :** Plusieurs formulations sont générales et pourraient s’appliquer à de nombreux contextes similaires. Les idées s’enchaînent de manière logique mais attendue.\n**Présence d’une voix humaine :** Le texte imite une réflexion personnelle, mais sans détails précis ni vécu concret. La voix semble plausible, mais reste peu marquée et relativement neutre émotionnellement.",
  "final_score": {
    "probability": 0.7,
    "conclusion": "Le texte reprend les codes d’un message personnel, mais l’absence de détails spécifiques et l’enchaînement très lisse des idées suggèrent une génération automatique."
  }
}
\`\`\`

---

### EXEMPLE 3 (Texte Humain Très Soigné)
**Contexte :** https://www.reddit.com/r/france/comments/exemple
**Texte à analyser :** "Peut-être que le problème vient du fait qu’on cherche absolument un sens global à quelque chose qui n’en a pas. L’existence, prise individuellement, n’a rien d’extraordinaire, et pourtant on continue d’y projeter des attentes immenses. Accepter cette banalité est sans doute plus difficile qu’il n’y paraît."
**Réponse attendue :**
\`\`\`json
{
  "analysis_report": "**Variété et naturel de l’écriture :** Les phrases sont longues et bien construites, avec une structure maîtrisée, mais suffisamment variée pour rester fluide.\n**Prévisibilité du langage :** Le vocabulaire est précis et les formulations sont travaillées, avec des enchaînements d’idées moins attendus que dans un texte générique.\n**Présence d’une voix humaine :** Le texte exprime une réflexion personnelle approfondie et un point de vue identifiable. Malgré un style soigné, la voix de l’auteur reste perceptible.",
  "final_score": {
    "probability": 0.3,
    "conclusion": "Bien que très rédigé, le texte montre des indices clairs d’écriture humaine, notamment par la profondeur de la réflexion et la cohérence du point de vue."
  }
}
\`\`\`

---

### EXEMPLE 4 (Texte ambigu (humain ou IA difficile à distinguer))
**Contexte :** https://www.reddit.com/r/france/comments/exemple
**Texte à analyser :** "La vraie richesse, au final, c’est pas forcément ce qu’on possède. C’est plutôt les petits moments, les souvenirs qui restent. Un message inattendu, un rappel du passé… rien de fou, mais ça fait réfléchir. Après, chacun voit midi à sa porte."
**Réponse attendue :**
\`\`\`json
{
  "analysis_report": "**Variété et naturel de l’écriture :** Le texte est fluide et agréable à lire, mais la longueur et la structure des phrases restent assez régulières.\n**Prévisibilité du langage :** Les idées exprimées sont communes et les formulations restent relativement générales, ce qui les rend facilement anticipables.\n**Présence d’une voix humaine :** Une voix personnelle est suggérée, mais elle reste peu incarnée. Le texte manque de détails concrets qui permettraient d’identifier clairement un vécu réel.",
  "final_score": {
    "probability": 0.5,
    "conclusion": "Le texte se situe dans une zone d’incertitude. Il pourrait aussi bien correspondre à une réflexion humaine simple qu’à un texte généré cherchant à imiter un style personnel."
  }
}
\`\`\`
---

## ATTENTION! certains textes générés automatiquement peuvent volontairement imiter un style oral, hésitant ou très personnel. Ces éléments ne suffisent pas, à eux seuls, à conclure à une écriture humaine.

### Début de ton analyse :

Contexte visuel : utilise la capture d’écran de la page web pour comprendre le style visuel, la mise en page et le contexte dans lequel le texte apparaît.

URL de contexte : ${pageUrl}

Texte à analyser :
"${textToEvaluate}"

### Règles de réponse STRICTES :
- L’intégralité de "analysis_report" doit être rédigée en français clair et accessible
- Le ton doit être neutre, explicatif et factuel
- Ne jamais utiliser de termes techniques ou académiques
- Ne pas mentionner de modèles, d’IA spécifique ou d’outils
- Se baser uniquement sur les caractéristiques visibles du texte

### Réponse attendue :
Un objet JSON strictement valide, et rien d’autre.
`;

    const imageBase64 = contextImageDataUrl.split(',')[1];
    
    const { selectedModel } = await chrome.storage.local.get('selectedModel');
    const model = selectedModel || 'gemma3'; 

    callOllamaAPI('evaluate', { model: model, prompt: prompt, images: [imageBase64], format: 'json', stream: false });
}

// --- Ollama Response Handlers ---

async function handleOllamaSuccess(data, originalAction) {
    await chrome.storage.local.set({ isProcessing: false });

    console.log("Ollama response received for action:", originalAction, "Response :", data.response);

    if (originalAction === 'extractText') {
        updateStatus("Text extraction complete.");
        const extractedText = data.response;
        await chrome.storage.local.set({ extractedText: extractedText });
        
        // Log extract_text_ended with the extracted text
        await saveLog({
            event_type: 'extract_text_ended',
            extracted_text: extractedText
        });
        console.log("[EXTRACT_TEXT_ENDED] Logged extract_text_ended event. Extracted text length:", extractedText?.length || 0);
    } else if (originalAction === 'evaluate') {
        try {
            const resultJson = JSON.parse(data.response);
            console.log("Parsed analysis JSON:", resultJson);
            let score = 0.5;
            let reasonMarkdown = "No detailed analysis provided.";

            if (resultJson.final_score) {
                if (typeof resultJson.final_score.probability !== 'undefined') {
                    score = resultJson.final_score.probability;
                } else if (typeof resultJson.final_score.score !== 'undefined') {
                    score = resultJson.final_score.score;
                } else if (typeof resultJson.final_score === 'number') {
                    score = resultJson.final_score;
                }
            }

            // Extract conclusion separately
            let conclusion = resultJson.final_score?.conclusion || null;

            if (resultJson.analysis_report && typeof resultJson.analysis_report === 'string' && resultJson.analysis_report.trim() !== "") {
                reasonMarkdown = resultJson.analysis_report;
            } 
            else if (resultJson.analysis_report && typeof resultJson.analysis_report === 'object') {
                let tempReason = "";
                for (const [key, value] of Object.entries(resultJson.analysis_report)) {
                    const cleanedKey = key.substring(key.indexOf(' ') + 1);
                    tempReason += `**${cleanedKey}**\n${value}\n\n`;
                }
                reasonMarkdown = tempReason.trim();
            }
            else if (conclusion) {
                reasonMarkdown = "No detailed analysis provided.";
            }

            if (!reasonMarkdown || reasonMarkdown.trim() === "") {
                reasonMarkdown = "No detailed analysis provided.";
            }

            // Calculate uncertainty based on probability (as a number between 0 and 1)
            const probabilityAsNumber = typeof score === 'string' ? parseFloat(score) : score;
            let uncertainty = 'low';
            if ((probabilityAsNumber >= 0.4 && probabilityAsNumber <= 0.6)) {
                uncertainty = 'high';
            } else if ((probabilityAsNumber >= 0.2 && probabilityAsNumber <= 0.4) || (probabilityAsNumber >= 0.6 && probabilityAsNumber <= 0.8)) {
                uncertainty = 'medium';
            }
            
            // Get the extracted text from storage for the log
            const { extractedText } = await chrome.storage.local.get('extractedText');
            
            // Log evaluation_ended with all required fields including conclusion
            await saveLog({
                event_type: 'evaluation_ended',
                extracted_text: extractedText || null,
                ai_output_probability: probabilityAsNumber,
                ai_output_response: reasonMarkdown,
                ai_output_conclusion: conclusion,
                ai_uncertainty: uncertainty
            });
            console.log("[EVALUATION_ENDED] Logged evaluation_ended event. Probability:", probabilityAsNumber, "Uncertainty:", uncertainty, "Conclusion:", conclusion);

            const formattedResult = `[PROB:${score}]${reasonMarkdown}`;
            updateStatus("Evaluation complete.");
            await chrome.storage.local.set({ 
                evaluationResult: formattedResult,
                evaluationConclusion: conclusion,
                awaitingConfidence: true // Mark that we're awaiting user confidence
            });

        } catch (e) {
            console.error("Error parsing analysis JSON:", e, "Raw response:", data.response);
            handleOllamaError("Failed to parse analysis JSON from Ollama.", originalAction);
        }
    }
    sendCurrentStateToPopup();
}


async function handleOllamaError(error, originalAction) {
    console.error(`Ollama error during ${originalAction}:`, error);
    const userMessage = "Ollama connection failed. Is the server running?";
    
    // Set persistent processing and error flags in storage ---
    await chrome.storage.local.set({
        isProcessing: false,
        errorMessage: userMessage,
        // Also set evaluationResult to an error state if that was the action
        ...(originalAction === 'evaluate' && { evaluationResult: `[ERROR]${userMessage}` })
    });

    updateStatus(`Error: ${error}`); // This updates the transient status
    sendCurrentStateToPopup(); // This sends the persistent state to the UI
}



// --- Utility Functions ---

async function callOllamaAPI(originalAction, params) {
    // Set processing flag before making the call ---
    await chrome.storage.local.set({ isProcessing: true, errorMessage: null });
    updateStatus(originalAction === 'evaluate' ? "Evaluating..." : "Extracting text...");
    sendCurrentStateToPopup(); // Immediately update UI to show "Processing"

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            throw new Error(`Ollama API request failed with status ${response.status}`);
        }

        const data = await response.json();
        handleOllamaSuccess(data, originalAction);

    } catch (error) {
        console.error("Background fetch error:", error);
        handleOllamaError(error.message, originalAction);
    }
}

async function downloadImageForDebugging(dataUrl, type) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${type}-capture-${timestamp}.jpg`;
    
    return new Promise((resolve) => {
        chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error(`Download failed for ${filename}:`, chrome.runtime.lastError.message);
                resolve(null);
            } else {
                console.log(`Successfully saved ${filename} for debugging.`);
                // Store the capture name in storage for later use in logging
                chrome.storage.local.set({ captureName: filename });
                resolve(filename);
            }
        });
    });
}

function updateStatus(message) {
    console.log("Status:", message);
    chrome.runtime.sendMessage({ action: "updateStatus", message: message }, () => {
        if (chrome.runtime.lastError) { /* Do nothing */ }
    });
}

async function sendCurrentStateToPopup() {
    const data = await chrome.storage.local.get([
        "contextImageDataUrl", 
        "extractedText", 
        "evaluationResult",
        "evaluationConclusion",
        "selectedModel",
        "debugMode",
        "useStoredLLMResponse",
        "userAlone",
        "isProcessing",
        "errorMessage",
        "awaitingConfidence"
    ]);
    chrome.runtime.sendMessage({ action: "updateUI", data: data }, () => {
        if (chrome.runtime.lastError) { /* Do nothing */ }
    });
}

// --- Offscreen Document Management ---

async function hasDocument() {
    const matchedClients = await clients.matchAll();
    return matchedClients.some(c => c.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
}

async function setupOffscreenDocument(path) {
    if (!(await hasDocument())) {
        await chrome.offscreen.createDocument({
            url: path,
            reasons: ['BLOBS'],
            justification: 'Cropping images on a canvas.',
        });
    }
}

async function closeOffscreenDocument() {
    if (await hasDocument()) {
        await chrome.offscreen.closeDocument();
    }
}

// --- Opening Tabs for Experiment ---
async function openAndRun() {
  const config = await fetch(chrome.runtime.getURL("posts.json"))
    .then(r => r.json());

  // Shuffle the config array to randomize tab order
  const shuffledConfig = config.slice(); // Create a copy
  for (let i = shuffledConfig.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledConfig[i], shuffledConfig[j]] = [shuffledConfig[j], shuffledConfig[i]];
  }

  for (const entry of shuffledConfig) {
    const tab = await chrome.tabs.create({
      url: entry.urlMatch
    });

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId },
            files: ["create_tabs.js"]
          });
        }, 5000);
      }
    });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action && msg.action === "createTabs") {
        openAndRun();
    }
});



