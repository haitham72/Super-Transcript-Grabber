document.getElementById("extractBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  const btn = document.getElementById("extractBtn");

  resultDiv.textContent =
    "Extracting transcript... (this may take 10-30 seconds for long videos)";
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab.url.includes("youtube.com/watch")) {
      resultDiv.innerHTML =
        '<span class="error">Please open a YouTube video first!</span>';
      btn.disabled = false;
      return;
    }

    // Inject and execute the extraction function
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractTranscript,
    });

    const transcript = results[0].result;

    if (
      transcript.startsWith("Error:") ||
      transcript.includes("not found") ||
      transcript.includes("No transcript")
    ) {
      resultDiv.innerHTML = `<span class="error">${transcript}</span>`;
    } else {
      // Download the transcript
      downloadTranscript(transcript, tab.title);
      resultDiv.innerHTML = `<span class="success">✓ Downloaded! ${
        transcript.length
      } characters extracted</span><hr>${transcript.substring(0, 500)}...`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  } finally {
    btn.disabled = false;
  }
});

// Function to download transcript as text file
function downloadTranscript(transcript, videoTitle) {
  // Clean up video title for filename
  const cleanTitle = videoTitle
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const filename = `transcript_${cleanTitle}_${Date.now()}.txt`;

  const blob = new Blob([transcript], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  // Append to body, click, then remove (more reliable)
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Clean up the URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// This function gets injected into the YouTube page
async function extractTranscript() {
  try {
    const video = document.querySelector("video");
    if (!video) return "Error: Video element not found";

    const duration = video.duration || 600;
    const groupBy = duration >= 1200 ? 60 : duration < 480 ? 10 : 30;

    let shouldClose = false;
    let segments = document.querySelectorAll("ytd-transcript-segment-renderer");

    // If segments not visible, try to open transcript
    if (segments.length === 0) {
      let opened = false;

      // Wait for page to be fully ready first
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const buttons = Array.from(document.querySelectorAll("button"));

      // Method 1: Try "Transcript" button/tab FIRST (most reliable)
      const transcriptButton = buttons.find((btn) => {
        const label = btn.getAttribute("aria-label");
        const text = btn.textContent?.trim().toLowerCase();
        return label === "Transcript" || text === "transcript";
      });

      if (transcriptButton) {
        transcriptButton.click();
        shouldClose = true;

        // Wait longer and check multiple times
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          segments = document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          );
          if (segments.length > 0) {
            opened = true;
            break;
          }
        }
      }

      // Method 2: Try three-dot menu approach (if first failed)
      if (!opened) {
        const moreButton = buttons.find((btn) =>
          btn.getAttribute("aria-label")?.includes("More actions")
        );

        if (moreButton) {
          moreButton.click();
          await new Promise((resolve) => setTimeout(resolve, 500));

          const menuButtons = Array.from(
            document.querySelectorAll("button, ytd-menu-service-item-renderer")
          );
          const transcriptOption = menuButtons.find((btn) =>
            btn.textContent?.toLowerCase().includes("show transcript")
          );

          if (transcriptOption) {
            transcriptOption.click();
            shouldClose = true;

            for (let i = 0; i < 15; i++) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              segments = document.querySelectorAll(
                "ytd-transcript-segment-renderer"
              );
              if (segments.length > 0) {
                opened = true;
                break;
              }
            }
          }
        }
      }

      // Final fallback: wait even longer
      if (!opened && segments.length === 0) {
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          segments = document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          );
          if (segments.length > 0) break;
        }
      }

      if (segments.length === 0) {
        return "Error: No transcript available for this video. Try refreshing the page and waiting a few seconds before clicking Extract.";
      }
    }

    // Find the scrollable transcript container - try multiple selectors
    let transcriptContainer =
      document.querySelector("#segments-container") ||
      document.querySelector(
        "ytd-transcript-segment-list-renderer #segments-container"
      ) ||
      document.querySelector('[id="segments-container"]') ||
      document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #content'
      );

    if (transcriptContainer) {
      let previousCount = segments.length;
      let stableCount = 0;
      const maxScrollAttempts = 60; // Increased for very long videos

      // Scroll to load all segments
      for (let i = 0; i < maxScrollAttempts; i++) {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 150)); // Faster scrolling

        segments = document.querySelectorAll("ytd-transcript-segment-renderer");

        if (segments.length === previousCount) {
          stableCount++;
          if (stableCount >= 4) break; // More stable checks
        } else {
          stableCount = 0;
          previousCount = segments.length;
        }
      }
    } else {
      // Container not found - might already have all segments loaded
      console.log("Transcript container not found, using existing segments");
    }

    // Parse and group segments
    const groups = {};
    Array.from(segments).forEach((seg) => {
      const time =
        seg.querySelector(".segment-timestamp")?.textContent.trim() || "0:00";
      const text = seg.querySelector(".segment-text")?.textContent.trim() || "";

      if (!text) return;

      const parts = time.split(":").map(Number);
      const seconds =
        parts.length === 2
          ? parts[0] * 60 + parts[1]
          : parts[0] * 3600 + parts[1] * 60 + parts[2];

      const group = Math.floor(seconds / groupBy) * groupBy;

      if (!groups[group]) groups[group] = [];
      groups[group].push(text);
    });

    if (Object.keys(groups).length === 0) {
      return `Error: Found ${segments.length} segments but couldn't extract text. This might be a YouTube layout issue.`;
    }

    const result = Object.keys(groups)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => {
        const mins = Math.floor(key / 60);
        const secs = key % 60;
        const time = `${mins}:${secs.toString().padStart(2, "0")}`;
        return `[${time}] ${groups[key].join(" ")}`;
      })
      .join("\n");

    // Close transcript panel if we opened it
    if (shouldClose) {
      const closeButtons = buttons.filter((btn) => {
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        return label.includes("close") && label.includes("transcript");
      });
      if (closeButtons.length > 0) closeButtons[0].click();
    }

    return result;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
