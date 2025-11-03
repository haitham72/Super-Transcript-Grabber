document.getElementById("extractBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  resultDiv.textContent = "Extracting...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes("youtube.com/watch")) {
    resultDiv.innerHTML =
      '<span class="error">Please open a YouTube video first!</span>';
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractTranscript,
    });

    const transcript = results[0].result;

    if (
      transcript.startsWith("Error:") ||
      transcript.startsWith("Could not") ||
      transcript.startsWith("No captions")
    ) {
      resultDiv.innerHTML = `<span class="error">${transcript}</span>`;
    } else {
      // DOWNLOAD THE CONTENT
      const blob = new Blob([transcript], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transcript.txt";
      a.click();
      URL.revokeObjectURL(url);

      resultDiv.innerHTML = `<span class="success">Success! ${transcript.length} characters - File downloaded!</span>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  }
});

async function extractTranscript() {
  try {
    // Get video duration
    const video = document.querySelector("video");
    if (!video) return "Video element not found";

    const duration = video.duration || 600;
    const groupBy = duration >= 1200 ? 60 : duration < 480 ? 10 : 30;

    // Find transcript button (multiple approaches)
    const buttons = Array.from(document.querySelectorAll("button"));
    const transcriptButton = buttons.find((btn) => {
      const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
      return label.includes("transcript") || label.includes("show transcript");
    });

    if (!transcriptButton) {
      return "No transcript available for this video";
    }

    // Check if already open
    const panel = document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-transcript"]'J
    );
    const wasOpen =
      panel?.getAttribute("visibility") ===
      "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";

    if (!wasOpen) {
      transcriptButton.click();
    }

    // Wait for segments with timeout
    let segments;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      segments = document.querySelectorAll("ytd-transcript-segment-renderer");
      if (segments.length > 0) break;
    }

    if (!segments || segments.length === 0) {
      if (!wasOpen) transcriptButton.click();
      return "Transcript loaded but no content found";
    }

    // Parse and group
    const groups = {};
    Array.from(segments).forEach((seg) => {
      const time =
        seg.querySelector(".segment-timestamp")?.textContent.trim() || "0:00";
      const text = seg.querySelector(".segment-text")?.textContent.trim() || "";

      if (!text) return; // Skip empty

      const parts = time.split(":").map(Number);
      const seconds =
        parts.length === 2
          ? parts[0] * 60 + parts[1]
          : parts[0] * 3600 + parts[1] * 60 + parts[2];

      const group = Math.floor(seconds / groupBy) * groupBy;

      if (!groups[group]) groups[group] = [];
      groups[group].push(text);
    });

    // Format output
    const result = Object.keys(groups)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => {
        const mins = Math.floor(key / 60);
        const secs = key % 60;
        const time = `${mins}:${secs.toString().padStart(2, "0")}`;
        return `[${time}] ${groups[key].join(" ")}`;
      })
      .join("\n");

    // Close if we opened it
    if (!wasOpen) {
      transcriptButton.click();
    }

    return result;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
