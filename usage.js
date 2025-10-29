/**
 * Silent Usage Counter (safe template)
 * ------------------------------------
 * Increments data/usage.json in your GitHub repo.
 * 
 * ⚠️  Do NOT paste a live token here.
 *      Replace GITHUB_PAT below only in your local/private copy,
 *      never commit it to GitHub or share it.
 */

const REPO_OWNER = "katpally123";
const REPO_NAME  = "pxt-usage";
const FILE_PATH  = "data/usage.json";
const BRANCH     = "main";

async function trackUsage() {
  try {
    // ------------- INSERT YOUR TOKEN LOCALLY ONLY -------------
    const GITHUB_PAT = "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"; // <— your new PAT goes here
    // ----------------------------------------------------------

    if (!GITHUB_PAT || sessionStorage.getItem("pxt_usage_counted")) return;
    const API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=${BRANCH}`;

    // 1. Read current JSON
    const getRes = await fetch(API, {
      headers: { Authorization: `token ${GITHUB_PAT}` }
    });
    if (!getRes.ok) throw new Error("Failed to fetch usage.json");

    const file = await getRes.json();
    const data = JSON.parse(atob(file.content));

    // 2. Increment count
    data.totalUses = (data.totalUses || 0) + 1;
    data.lastUpdated = new Date().toISOString();
    if (!data.usageHistory) data.usageHistory = [];
    data.usageHistory.push({ timestamp: new Date().toISOString() });
    if (data.usageHistory.length > 100)
      data.usageHistory = data.usageHistory.slice(-100);

    // 3. Commit update
    const putBody = {
      message: "usage++",
      content: btoa(JSON.stringify(data, null, 2)),
      sha: file.sha,
      branch: BRANCH
    };

    const putRes = await fetch(API, {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_PAT}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) throw new Error("Failed to update usage.json");
    sessionStorage.setItem("pxt_usage_counted", "1");
    console.log("Usage tracking updated successfully");
  } catch (err) {
    console.debug("usage tracking skipped:", err);
  }
}
