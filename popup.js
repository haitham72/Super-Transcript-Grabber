document.getElementById("extractBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  const btn = document.getElementById("extractBtn");

  resultDiv.textContent = "Extracting transcript...";
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
      // DOWNLOAD THE TRANSCRIPT - THIS LINE IS CRITICAL
      downloadTranscript(transcript);
      resultDiv.innerHTML = `<span class="success">✓ Success! Downloaded ${
        transcript.length
      } characters</span><hr>${transcript.substring(0, 500)}...`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  } finally {
    btn.disabled = false;
  }
});

// Function to download transcript as text file
function downloadTranscript(transcript) {
  const blob = new Blob([transcript], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `youtube-transcript-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// This function gets injected into the YouTube page
async function extractTranscript() {
  try {
    const video = document.querySelector("video");
    if (!video) return "Error: Video element not found";

    const duration = video.duration || 600;
    const groupBy = duration >= 1200 ? 60 : duration < 480 ? 10 : 30;

    const buttons = Array.from(document.querySelectorAll("button"));
    let transcriptOpened = false;
    let shouldClose = false;

    // Check if transcript is already open FIRST
    let segments = document.querySelectorAll("ytd-transcript-segment-renderer");
    if (segments.length > 0) {
      transcriptOpened = true;
    }

    // METHOD 1: Try "Show transcript" button (most common)
    if (!transcriptOpened) {
      const showTranscript = buttons.find((btn) => {
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        return label.includes("show transcript");
      });

      if (showTranscript) {
        showTranscript.click();
        shouldClose = true;

        // Wait longer and check multiple times
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          segments = document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          );
          if (segments.length > 0) {
            transcriptOpened = true;
            break;
          }
        }
      }
    }

    // METHOD 2: Try "Transcript" tab button (for videos with chapters)
    if (!transcriptOpened) {
      const transcriptTab = buttons.find((btn) => {
        const label = btn.getAttribute("aria-label");
        const text = btn.textContent?.trim();
        return label === "Transcript" || text === "Transcript";
      });

      if (transcriptTab) {
        transcriptTab.click();
        shouldClose = true;

        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          segments = document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          );
          if (segments.length > 0) {
            transcriptOpened = true;
            break;
          }
        }
      }
    }

    // METHOD 3: Try finding button with "transcript" in aria-label (any variation)
    if (!transcriptOpened) {
      const anyTranscriptButton = buttons.find((btn) => {
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        const text = btn.textContent?.toLowerCase() || "";
        return (
          (label.includes("transcript") || text.includes("transcript")) &&
          !label.includes("close")
        );
      });

      if (anyTranscriptButton) {
        anyTranscriptButton.click();
        shouldClose = true;

        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          segments = document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          );
          if (segments.length > 0) {
            transcriptOpened = true;
            break;
          }
        }
      }
    }

    if (!transcriptOpened) {
      return "Error: Could not open transcript panel - no captions may be available";
    }

    // Extra wait for long videos (segments might still be loading)
    if (duration > 1200) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      segments = document.querySelectorAll("ytd-transcript-segment-renderer");
    }

    if (!segments || segments.length === 0) {
      return "Error: Transcript panel opened but no segments loaded";
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
      return "Error: Segments found but no text extracted";
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
      const closeButton = buttons.find((btn) => {
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        return label.includes("close") && label.includes("transcript");
      });

      if (closeButton) {
        closeButton.click();
      }
    }

    return result;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
