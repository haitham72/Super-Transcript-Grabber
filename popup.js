document.getElementById("extractBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  const btn = document.getElementById("extractBtn");

  resultDiv.textContent =
    "Extracting full video data... (this may take 10-30 seconds for long videos)";
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
      func: extractTranscriptAndChapters,
    });

    const data = results[0].result;

    // Check if it's actually an error
    if (
      typeof data === "string" &&
      (data.startsWith("Error:") ||
        data === "No transcript available" ||
        data.includes("Video element not found"))
    ) {
      resultDiv.innerHTML = `<span class="error">${data}</span>`;
    } else {
      // Create structured JSON output for AI consumption
      const structuredData = {
        metadata: {
          video_title: data.metadata.title,
          video_url: tab.url,
          video_id: data.metadata.videoId,
          channel_name: data.metadata.channelName,
          channel_url: data.metadata.channelUrl,
          duration: data.metadata.duration,
          duration_formatted: data.metadata.durationFormatted,
          view_count: data.metadata.viewCount,
          upload_date: data.metadata.uploadDate,
          like_count: data.metadata.likeCount,
          extraction_date: new Date().toISOString(),
        },
        description: data.description,
        chapters: data.chapters
          ? data.chapters
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                const match = line.match(/^(.+?)\s+-\s+(.+)$/);
                return match
                  ? { timestamp: match[1], title: match[2] }
                  : { raw: line };
              })
          : [],
        transcript: data.transcript
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            const match = line.match(/^\[(.+?)\]\s+(.+)$/);
            return match
              ? { timestamp: match[1], text: match[2] }
              : { raw: line };
          }),
        tags: data.tags || [],
      };

      const jsonOutput = JSON.stringify(structuredData, null, 2);

      // Download as JSON
      try {
        downloadTranscript(jsonOutput, data.metadata.title, "json");
        const chapterInfo = data.chapters
          ? ` (${data.chapterCount} chapters)`
          : "";
        const preview = jsonOutput
          .substring(0, 500)
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        resultDiv.innerHTML = `<span class="success">✓ Downloaded JSON!${chapterInfo} Full video data extracted (${jsonOutput.length} characters)</span><hr><pre style="white-space: pre-wrap; font-size: 11px;">${preview}...</pre>`;
      } catch (downloadError) {
        // Fallback: copy to clipboard
        navigator.clipboard
          .writeText(jsonOutput)
          .then(() => {
            const preview = jsonOutput
              .substring(0, 500)
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            resultDiv.innerHTML = `<span class="error">Download failed, but JSON copied to clipboard! (${jsonOutput.length} chars)</span><hr><pre style="white-space: pre-wrap; font-size: 11px;">${preview}...</pre>`;
          })
          .catch(() => {
            resultDiv.innerHTML = `<span class="error">Download failed: ${downloadError.message}</span>`;
          });
      }
    }
  } catch (error) {
    resultDiv.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  } finally {
    btn.disabled = false;
  }
});

// Function to download transcript as text or JSON file
function downloadTranscript(content, videoTitle, format = "txt") {
  try {
    // Clean up video title for filename
    const cleanTitle = (videoTitle || "youtube_video")
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .substring(0, 50);

    const extension = format === "json" ? "json" : "txt";
    const mimeType = format === "json" ? "application/json" : "text/plain";
    const filename = `transcript_${cleanTitle}_${Date.now()}.${extension}`;

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";

    // Append to body, click, then remove (more reliable)
    document.body.appendChild(a);

    // Force click with timeout to ensure it happens
    setTimeout(() => {
      a.click();
      console.log("Download triggered for:", filename);

      // Clean up after download starts
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
    }, 10);
  } catch (error) {
    console.error("Download error:", error);
    throw error;
  }
}

// This function gets injected into the YouTube page
async function extractTranscriptAndChapters() {
  try {
    const video = document.querySelector("video");
    if (!video) return "Error: Video element not found";

    const duration = video.duration || 600;
    // Fixed grouping logic: 60s for 20+ min videos, 30s for 8-20 min, 15s for shorter
    const groupBy = duration >= 1200 ? 60 : duration >= 480 ? 30 : 15;

    // === EXTRACT METADATA ===
    const metadata = {
      title:
        document
          .querySelector("h1.ytd-watch-metadata yt-formatted-string")
          ?.textContent?.trim() ||
        document.querySelector("h1.title")?.textContent?.trim() ||
        "Unknown Title",
      videoId: new URLSearchParams(window.location.search).get("v") || "",
      channelName:
        document
          .querySelector("ytd-channel-name#channel-name yt-formatted-string a")
          ?.textContent?.trim() ||
        document.querySelector("#channel-name a")?.textContent?.trim() ||
        "Unknown Channel",
      channelUrl:
        document.querySelector(
          "ytd-channel-name#channel-name yt-formatted-string a"
        )?.href ||
        document.querySelector("#channel-name a")?.href ||
        "",
      duration: Math.floor(duration),
      durationFormatted: new Date(duration * 1000)
        .toISOString()
        .substr(11, 8)
        .replace(/^00:/, ""),
      viewCount:
        document
          .querySelector("ytd-video-view-count-renderer .view-count")
          ?.textContent?.trim() ||
        document.querySelector("#info span.view-count")?.textContent?.trim() ||
        "Unknown",
      uploadDate:
        document
          .querySelector("#info-strings yt-formatted-string")
          ?.textContent?.trim() ||
        document
          .querySelector("#date yt-formatted-string")
          ?.textContent?.trim() ||
        "Unknown",
      likeCount:
        document
          .querySelector('like-button-view-model button[aria-label*="like"]')
          ?.getAttribute("aria-label") ||
        document
          .querySelector("ytd-toggle-button-renderer.ytd-menu-renderer button")
          ?.getAttribute("aria-label") ||
        "Unknown",
    };

    // === EXTRACT DESCRIPTION ===
    let description = "";
    const descriptionElement =
      document.querySelector(
        "#description-inline-expander yt-attributed-string span"
      ) ||
      document.querySelector("#description yt-formatted-string") ||
      document.querySelector("ytd-text-inline-expander #content");

    if (descriptionElement) {
      // Try to expand description if collapsed
      const expandButton =
        document.querySelector(
          "#description-inline-expander tp-yt-paper-button#expand"
        ) || document.querySelector("#description tp-yt-paper-button#more");
      if (
        expandButton &&
        expandButton.textContent.toLowerCase().includes("more")
      ) {
        expandButton.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Get the full description text
      const fullDescElement =
        document.querySelector(
          "#description-inline-expander yt-attributed-string span"
        ) || document.querySelector("#description yt-formatted-string");
      description = fullDescElement?.textContent?.trim() || "";
    }

    // === EXTRACT TAGS ===
    let tags = [];
    try {
      // Tags are usually in meta keywords or in the page data
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      if (metaKeywords) {
        tags = metaKeywords
          .getAttribute("content")
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t);
      }

      // Alternative: extract from ytInitialData
      if (tags.length === 0 && window.ytInitialData) {
        const videoDetails =
          window.ytInitialData?.contents?.twoColumnWatchNextResults?.results
            ?.results?.contents?.[0]?.videoPrimaryInfoRenderer;
        if (videoDetails?.superTitleLink?.runs) {
          tags = videoDetails.superTitleLink.runs
            .map((run) => run.text)
            .filter((t) => t);
        }
      }
    } catch (e) {
      console.log("Could not extract tags:", e);
    }

    // === EXTRACT CHAPTERS FIRST (non-invasive) ===
    let chaptersText = "";
    let chapterCount = 0;

    // Method 1: Try to get chapters from the description or chapters panel
    const chapterElements = document.querySelectorAll(
      'ytd-macro-markers-list-item-renderer, ytd-engagement-panel-title-header-renderer[class*="macro-markers"]'
    );

    if (chapterElements.length > 0) {
      const chapters = [];
      document
        .querySelectorAll("ytd-macro-markers-list-item-renderer")
        .forEach((item) => {
          const timeElement = item.querySelector("#time");
          const titleElement = item.querySelector("#details h4");

          if (timeElement && titleElement) {
            const time = timeElement.textContent.trim();
            const title = titleElement.textContent.trim();
            chapters.push(`${time} - ${title}`);
          }
        });

      if (chapters.length > 0) {
        chaptersText = chapters.join("\n");
        chapterCount = chapters.length;
      }
    }

    // Method 2: Try from video description expandable sections
    if (!chaptersText) {
      const descriptionChapters = document.querySelectorAll(
        "#structured-description ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer"
      );

      if (descriptionChapters.length > 0) {
        const chapters = [];
        descriptionChapters.forEach((item) => {
          const timeElement = item.querySelector("#time");
          const titleElement = item.querySelector("#details h4");

          if (timeElement && titleElement) {
            const time = timeElement.textContent.trim();
            const title = titleElement.textContent.trim();
            chapters.push(`${time} - ${title}`);
          }
        });

        if (chapters.length > 0) {
          chaptersText = chapters.join("\n");
          chapterCount = chapters.length;
        }
      }
    }

    // === EXTRACT TRANSCRIPT (existing logic) ===
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

    const transcriptText = Object.keys(groups)
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
      const allButtons = Array.from(document.querySelectorAll("button"));
      const closeButton = allButtons.find((btn) => {
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        return label.includes("close") && label.includes("transcript");
      });
      if (closeButton) closeButton.click();
    }

    return {
      metadata: metadata,
      description: description,
      chapters: chaptersText,
      chapterCount: chapterCount,
      transcript: transcriptText,
      tags: tags,
    };
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
