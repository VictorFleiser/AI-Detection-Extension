
(() => {
  fetch(chrome.runtime.getURL("posts.json"))
    .then(r => r.json())
    .then(config => {
      const entry = config.find(e =>
        location.href.includes(e.urlMatch)
      );
      if (!entry) return;


      function findSmallestMatch(selector, text) {
        const needle = text.replace(/\s+/g, " ").trim();

        let best = null;
        let bestLength = Infinity;

        for (const el of document.querySelectorAll(selector)) {
          const content = el.innerText.replace(/\s+/g, " ").trim();

          if (content.includes(needle)) {
            if (content.length < bestLength) {
              best = el;
              bestLength = content.length;
            }
          }
        }

        return best;
      }

      const target = findSmallestMatch(entry.selector, entry.contentSnippet);
      if (!target) {
        console.warn("Target not found:" , entry);
        return;
      }

      const useAI = Math.random() < 0.5;
      if (useAI) {
        target.innerText = entry.aiText;
      }
      
      // Add red outline to the modified element
      target.style.outline = '3px solid red';
      target.dataset.modifiedByExtension = 'true';

      console.log(location.href, " : ", useAI ? "AI version" : "Human version");
      
      // Store the AI/Human decision per tab via background (so multiple tabs don't overwrite each other)
      chrome.runtime.sendMessage({
        action: "setAIGeneratedPost",
        aiGeneratedPost: useAI,
        postUrl: location.href
      });
      chrome.storage.local.set({
        currentPostUrl: location.href
      });
      
      // Send log message to background script
      chrome.runtime.sendMessage({
        action: "logEntry",
        data: {
          event_type: "post_edited",
          ai_generated_post: useAI
        }
      });
      
      console.log("[POST_EDITED] AI Generated:", useAI, "Post URL:", location.href);
    });
})();