// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTranscript") {
    extractTranscript().then((transcript) => {
      sendResponse({ transcript: transcript });
    });
    return true; // Keep message channel open for async response
  }
});

async function extractTranscript() {
  try {
    // Method 1: Try to get from ytInitialPlayerResponse
    const scripts = document.querySelectorAll("script");
    let ytInitialPlayerResponse = null;

    for (const script of scripts) {
      const content = script.textContent;
      if (content.includes("ytInitialPlayerResponse")) {
        const match = content.match(/var ytInitialPlayerResponse = ({.+?});/);
        if (match) {
          ytInitialPlayerResponse = JSON.parse(match[1]);
          break;
        }
      }
    }

    if (!ytInitialPlayerResponse) {
      return "Could not find ytInitialPlayerResponse";
    }

    const captions =
      ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer
        ?.captionTracks;

    if (!captions || captions.length === 0) {
      return "No captions available for this video";
    }

    // Get English captions or first available
    const track = captions.find((c) => c.languageCode === "en") || captions[0];

    // Fetch the transcript
    const response = await fetch(track.baseUrl);
    const xmlText = await response.text();

    // Parse the XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const textNodes = xmlDoc.querySelectorAll("text");

    const transcript = Array.from(textNodes)
      .map((node) => {
        // Decode HTML entities
        const txt = node.textContent;
        const textarea = document.createElement("textarea");
        textarea.innerHTML = txt;
        return textarea.value;
      })
      .join(" ");

    return transcript;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
