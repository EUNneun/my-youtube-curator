const state = {
  videos: [],
  query: "",
  topic: "all",
  sort: "savedAtDesc",
};

const els = {
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  topicList: document.getElementById("topicList"),
  videoList: document.getElementById("videoList"),
  emptyState: document.getElementById("emptyState"),
  totalCount: document.getElementById("totalCount"),
  template: document.getElementById("videoItemTemplate"),
};

els.searchInput.addEventListener("input", event => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});

els.sortSelect.addEventListener("change", event => {
  state.sort = event.target.value;
  render();
});

loadVideos();

async function loadVideos() {
  const synced = await fetchJson("videos.json");
  const local = readLocalVideos();
  const videos = normalizeVideos(synced.length ? synced : local);

  state.videos = mergeById(videos);
  render();
}

async function fetchJson(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
  } catch {
    return [];
  }
}

function readLocalVideos() {
  try {
    const data = JSON.parse(localStorage.getItem("savedVideos") || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeVideos(rows) {
  return rows.map((row, index) => {
    const url = row.url || row.videoUrl || row.video_url || row.href || "";
    const id = row.id || row.videoId || row.video_id || extractVideoId(url);
    if (!id) return null;

    const title = clean(row.title || row.name || row.videoTitle) || `Saved video ${index + 1}`;
    const channel = clean(row.channel || row.channelTitle || row.videoOwnerChannelTitle) || "Unknown channel";
    const topic = clean(row.topic || row.category) || guessTopic(title);

    return {
      id,
      url: url && url.startsWith("http") ? url : `https://www.youtube.com/watch?v=${id}`,
      title,
      channel,
      topic,
      savedAt: clean(row.savedAt || row.published_at || row.publishedAt || row.date || row.time),
      summary: clean(row.summary || row.description) || makeSummary(title, channel),
      thumbnail: row.thumbnail || row.thumbnailUrl || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }).filter(Boolean);
}

function mergeById(videos) {
  const byId = new Map();
  videos.forEach(video => byId.set(video.id, { ...byId.get(video.id), ...video }));
  return [...byId.values()];
}

function extractVideoId(value) {
  if (!value) return "";
  const text = String(value);
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  return patterns.map(pattern => text.match(pattern)?.[1]).find(Boolean) || "";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function guessTopic(title) {
  const text = String(title || "").toLowerCase();
  const rules = [
    ["AI", ["ai", "agent", "automation", "llm", "gpt"]],
    ["Planning", ["product", "strategy", "roadmap"]],
    ["Research", ["research", "interview", "ux"]],
    ["Development", ["code", "coding", "developer", "api"]],
    ["Marketing", ["marketing", "growth", "brand"]],
  ];
  return rules.find(([, words]) => words.some(word => text.includes(word)))?.[0] || "Uncategorized";
}

function makeSummary(title, channel) {
  return `${channel}의 "${title}" 영상입니다. 동기화된 설명이나 요약이 있으면 이 영역에 표시됩니다.`;
}

function filteredVideos() {
  return [...state.videos]
    .filter(video => state.topic === "all" || video.topic === state.topic)
    .filter(video => {
      if (!state.query) return true;
      return `${video.title} ${video.channel} ${video.topic} ${video.summary}`.toLowerCase().includes(state.query);
    })
    .sort((a, b) => {
      if (state.sort === "titleAsc") return a.title.localeCompare(b.title, "ko");
      if (state.sort === "channelAsc") return a.channel.localeCompare(b.channel, "ko");
      return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
    });
}

function render() {
  const videos = filteredVideos();
  renderTopics();
  renderList(videos);
  els.totalCount.textContent = String(state.videos.length);
  els.emptyState.classList.toggle("hidden", state.videos.length > 0);
}

function renderTopics() {
  const topics = ["all", ...new Set(state.videos.map(video => video.topic))];
  els.topicList.replaceChildren(...topics.map(topic => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `topic-pill${state.topic === topic ? " active" : ""}`;
    button.textContent = topic === "all" ? "전체" : topic;
    button.addEventListener("click", () => {
      state.topic = topic;
      render();
    });
    return button;
  }));
}

function renderList(videos) {
  els.videoList.replaceChildren(...videos.map(video => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const thumbLink = node.querySelector(".thumb-link");
    const titleLink = node.querySelector(".title-link");
    const thumb = node.querySelector(".thumb");

    thumbLink.href = video.url;
    titleLink.href = video.url;
    titleLink.textContent = video.title;
    thumb.src = video.thumbnail;
    thumb.alt = video.title;
    node.querySelector(".topic").textContent = video.topic;
    node.querySelector(".saved-at").textContent = formatDate(video.savedAt);
    node.querySelector(".channel").textContent = video.channel;
    node.querySelector(".summary").textContent = video.summary;

    return node;
  }));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}
