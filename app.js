const state = {
  videos: [],
  query: "",
  topic: "전체",
  sort: "savedAtDesc",
  done: new Set(JSON.parse(localStorage.getItem("watchedVideoIds") || "[]")),
};

const els = {
  fileInput: document.getElementById("fileInput"),
  linkInput: document.getElementById("linkInput"),
  parseLinksButton: document.getElementById("parseLinksButton"),
  sampleButton: document.getElementById("sampleButton"),
  clearButton: document.getElementById("clearButton"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  topicList: document.getElementById("topicList"),
  videoGrid: document.getElementById("videoGrid"),
  emptyState: document.getElementById("emptyState"),
  totalCount: document.getElementById("totalCount"),
  summaryStrip: document.getElementById("summaryStrip"),
  template: document.getElementById("videoCardTemplate"),
};

const samples = [
  {
    id: "dQw4w9WgXcQ",
    title: "프로덕트 전략을 빠르게 정리하는 방법",
    channel: "Example Strategy Lab",
    savedAt: "2026-04-29",
    topic: "기획",
    summary: "제품 방향, 우선순위, 고객 문제를 한 장짜리 전략 메모로 정리하는 흐름을 다룹니다.",
  },
  {
    id: "jNQXAC9IVRw",
    title: "AI 워크플로 자동화 입문",
    channel: "Automation Notes",
    savedAt: "2026-04-28",
    topic: "AI 자동화",
    summary: "반복 업무를 작은 단계로 쪼개고 API와 스프레드시트를 연결하는 자동화 기본기를 훑습니다.",
  },
  {
    id: "aqz-KE-bpKQ",
    title: "사용자 리서치 인터뷰 질문 만들기",
    channel: "UX Practice",
    savedAt: "2026-04-25",
    topic: "리서치",
    summary: "리서치 목표에서 인터뷰 질문으로 내려오는 과정과 유도 질문을 피하는 방법을 정리합니다.",
  },
];

els.fileInput.addEventListener("change", handleFiles);
els.parseLinksButton.addEventListener("click", () => addVideos(parseLinks(els.linkInput.value)));
els.sampleButton.addEventListener("click", () => addVideos(samples));
els.clearButton.addEventListener("click", clearAll);
els.searchInput.addEventListener("input", event => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});
els.sortSelect.addEventListener("change", event => {
  state.sort = event.target.value;
  render();
});

restore();
loadSyncedVideos();
render();

async function loadSyncedVideos() {
  try {
    const response = await fetch("videos.json", { cache: "no-store" });
    if (!response.ok) return;
    const videos = normalizeJson(await response.json());
    if (videos.length) addVideos(videos);
  } catch {
    // Opening the page directly from disk can block fetch; manual/local data still works.
  }
}

async function handleFiles(event) {
  const files = [...event.target.files];
  const batches = await Promise.all(files.map(readFile));
  addVideos(batches.flatMap(({ text, name }) => parseFile(text, name)));
  event.target.value = "";
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ text: String(reader.result || ""), name: file.name });
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function parseFile(text, name) {
  const lowerName = name.toLowerCase();

  if (lowerName.endsWith(".json")) {
    try {
      return normalizeJson(JSON.parse(text));
    } catch (error) {
      console.warn("JSON parse failed", error);
    }
  }

  if (lowerName.endsWith(".csv")) {
    return parseCsv(text);
  }

  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return parseHtmlLinks(text);
  }

  return parseLinks(text);
}

function normalizeJson(value) {
  const rows = Array.isArray(value) ? value : Object.values(value).find(Array.isArray) || [];
  return rows.map((row, index) => {
    const url = row.url || row.videoUrl || row.video_url || row.href || row.titleUrl || "";
    const id = row.id || row.videoId || row.video_id || extractVideoId(url);
    return normalizeVideo({
      id,
      url,
      title: row.title || row.name || row.videoTitle || `저장 영상 ${index + 1}`,
      channel: row.channel || row.channelTitle || row.subtitles?.[0]?.name || "채널 미확인",
      savedAt: row.savedAt || row.time || row.date || row.createdAt || "",
      topic: row.topic || row.category || guessTopic(row.title || ""),
      summary: row.summary || row.description || "",
    });
  }).filter(Boolean);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map(normalizeHeader);
  const hasHeader = header.some(cell => ["url", "title", "videoid", "video_id"].includes(cell));
  const rows = hasHeader ? lines.slice(1) : lines;

  return rows.map((line, index) => {
    const cells = splitCsvLine(line);
    const get = key => {
      const pos = header.indexOf(key);
      return pos >= 0 ? cells[pos] : "";
    };
    const url = hasHeader ? get("url") || get("titleurl") : cells.find(extractVideoId) || "";
    const title = hasHeader ? get("title") || get("name") : cells[0] || `저장 영상 ${index + 1}`;
    const id = hasHeader ? get("videoid") || get("video_id") || extractVideoId(url) : extractVideoId(url);

    return normalizeVideo({
      id,
      url,
      title,
      channel: hasHeader ? get("channel") || get("channeltitle") : cells[1] || "채널 미확인",
      savedAt: hasHeader ? get("savedat") || get("time") || get("date") : "",
      topic: guessTopic(title),
    });
  }).filter(Boolean);
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function splitCsvLine(line) {
  const result = [];
  let cell = "";
  let quoted = false;

  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  result.push(cell.trim());
  return result;
}

function parseHtmlLinks(text) {
  const matches = [...text.matchAll(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^"'<\s]+/gi)];
  return matches.map((match, index) => normalizeVideo({
    id: extractVideoId(match[0]),
    url: match[0],
    title: `저장 영상 ${index + 1}`,
    channel: "채널 미확인",
    topic: "미분류",
  })).filter(Boolean);
}

function parseLinks(text) {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => normalizeVideo({
      id: extractVideoId(line),
      url: line,
      title: `저장 영상 ${index + 1}`,
      channel: "채널 미확인",
      topic: "미분류",
    }))
    .filter(Boolean);
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
  const found = patterns.map(pattern => text.match(pattern)?.[1]).find(Boolean);
  return found || "";
}

function normalizeVideo(video) {
  if (!video.id) return null;
  const url = video.url && video.url.startsWith("http")
    ? video.url
    : `https://www.youtube.com/watch?v=${video.id}`;
  const title = clean(video.title) || "제목 미확인";
  const summary = clean(video.summary) || makeSummary(title, video.channel, video.topic);

  return {
    id: video.id,
    url,
    title,
    channel: clean(video.channel) || "채널 미확인",
    savedAt: clean(video.savedAt) || new Date().toISOString().slice(0, 10),
    topic: clean(video.topic) || guessTopic(title),
    summary,
    thumbnail: `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`,
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeSummary(title, channel, topic) {
  const guessed = topic || guessTopic(title);
  return `${guessed} 관점에서 다시 볼 만한 영상입니다. 제목과 채널 정보를 기준으로 우선 분류했으며, 자막이나 설명을 연결하면 더 정확한 요약으로 바꿀 수 있습니다.`;
}

function guessTopic(title) {
  const text = String(title || "").toLowerCase();
  const rules = [
    ["AI 자동화", ["ai", "agent", "automation", "자동화", "에이전트", "llm", "gpt"]],
    ["기획", ["product", "strategy", "roadmap", "기획", "전략", "프로덕트"]],
    ["리서치", ["research", "interview", "ux", "리서치", "인터뷰", "사용자"]],
    ["개발", ["code", "coding", "developer", "api", "개발", "코딩"]],
    ["마케팅", ["marketing", "growth", "brand", "마케팅", "브랜드", "성장"]],
  ];
  return rules.find(([, words]) => words.some(word => text.includes(word)))?.[0] || "미분류";
}

function addVideos(videos) {
  const byId = new Map(state.videos.map(video => [video.id, video]));
  videos.forEach(video => byId.set(video.id, { ...byId.get(video.id), ...video }));
  state.videos = [...byId.values()];
  persist();
  render();
}

function clearAll() {
  state.videos = [];
  state.topic = "전체";
  els.linkInput.value = "";
  persist();
  render();
}

function filteredVideos() {
  const query = state.query;
  return [...state.videos]
    .filter(video => state.topic === "전체" || video.topic === state.topic)
    .filter(video => {
      if (!query) return true;
      return `${video.title} ${video.channel} ${video.summary} ${video.topic}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (state.sort === "titleAsc") return a.title.localeCompare(b.title, "ko");
      if (state.sort === "channelAsc") return a.channel.localeCompare(b.channel, "ko");
      return String(b.savedAt).localeCompare(String(a.savedAt));
    });
}

function render() {
  const videos = filteredVideos();
  renderTopics();
  renderSummary(videos);
  renderCards(videos);
  els.totalCount.textContent = String(state.videos.length);
  els.emptyState.classList.toggle("hidden", state.videos.length > 0);
}

function renderTopics() {
  const topics = ["전체", ...new Set(state.videos.map(video => video.topic))];
  els.topicList.replaceChildren(...topics.map(topic => {
    const button = document.createElement("button");
    button.className = `topic-pill${state.topic === topic ? " active" : ""}`;
    button.type = "button";
    button.textContent = topic;
    button.addEventListener("click", () => {
      state.topic = topic;
      render();
    });
    return button;
  }));
}

function renderSummary(videos) {
  const topics = new Set(videos.map(video => video.topic)).size;
  const watched = videos.filter(video => state.done.has(video.id)).length;
  const channels = new Set(videos.map(video => video.channel)).size;
  const latest = videos[0]?.savedAt || "-";
  const cards = [
    ["현재 목록", `${videos.length}개`],
    ["주제", `${topics}개`],
    ["채널", `${channels}개`],
    ["봤음", `${watched}개`],
    ["최근 저장", latest],
  ];

  els.summaryStrip.replaceChildren(...cards.slice(0, 4).map(([label, value]) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    return card;
  }));
}

function renderCards(videos) {
  els.videoGrid.replaceChildren(...videos.map(video => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const thumbLink = node.querySelector(".thumb-link");
    const titleLink = node.querySelector(".title-link");
    const openVideo = node.querySelector(".open-video");
    const doneButton = node.querySelector(".mark-done");

    thumbLink.href = video.url;
    titleLink.href = video.url;
    openVideo.href = video.url;
    node.querySelector(".thumb").src = video.thumbnail;
    node.querySelector(".thumb").alt = video.title;
    node.querySelector(".topic").textContent = video.topic;
    node.querySelector(".saved-at").textContent = formatDate(video.savedAt);
    titleLink.textContent = video.title;
    node.querySelector(".channel").textContent = video.channel;
    node.querySelector(".summary").textContent = video.summary;

    if (state.done.has(video.id)) {
      doneButton.classList.add("done");
      doneButton.textContent = "완료";
    }

    doneButton.addEventListener("click", () => {
      if (state.done.has(video.id)) {
        state.done.delete(video.id);
      } else {
        state.done.add(video.id);
      }
      localStorage.setItem("watchedVideoIds", JSON.stringify([...state.done]));
      render();
    });

    return node;
  }));
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function persist() {
  localStorage.setItem("savedVideos", JSON.stringify(state.videos));
}

function restore() {
  try {
    state.videos = JSON.parse(localStorage.getItem("savedVideos") || "[]");
  } catch {
    state.videos = [];
  }
}
