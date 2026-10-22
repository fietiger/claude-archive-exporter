/* Claude 会话归档导出（Edge / Chrome，Manifest V3）
 * 在 claude.ai 会话页右下角生成「导出归档 ZIP」按钮。
 * 产物：index.html（自包含网页）、conversation.json（原始数据）、files/（附件、Artifact 源文件、Claude 投递的文件）。
 */
(() => {
  if (window.__claudeArchiveExporter) return;
  window.__claudeArchiveExporter = true;

  const enc = new TextEncoder();
  let busy = false;

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function human(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function safeName(s) {
    return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
  }
  function slug(s) {
    return String(s || "claude-conversation").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, "_").trim().slice(0, 60) || "claude-conversation";
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }
  function conversationId() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }
  function basename(p) {
    const s = String(p || "").replace(/\/+$/, "");
    return s.slice(s.lastIndexOf("/") + 1) || "file";
  }

  /* ---------------- 站内接口 ---------------- */
  async function jget(url) {
    const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(url + " → HTTP " + r.status);
    return r.json();
  }
  async function loadConversation(id) {
    const orgs = await jget("/api/organizations");
    if (!Array.isArray(orgs) || !orgs.length) throw new Error("无法获取组织列表");
    let lastError = null;
    for (const org of orgs) {
      try {
        const conv = await jget("/api/organizations/" + org.uuid + "/chat_conversations/" + id +
          "?tree=True&rendering_mode=messages&render_all_tools=true");
        return { org: org.uuid, conv: conv };
      } catch (e) { lastError = e; }
    }
    throw lastError || new Error("无法读取会话");
  }
  async function fetchFile(org, uuid) {
    const urls = [
      "/api/" + org + "/files/" + uuid + "/preview",
      "/api/organizations/" + org + "/files/" + uuid + "/content",
      "/api/organizations/" + org + "/files/" + uuid,
      "/api/organizations/" + org + "/files/" + uuid + "/download",
      "/api/files/" + uuid + "/content",
      "/api/files/" + uuid
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { credentials: "include" });
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "";
        if (ct.indexOf("json") >= 0) {
          const j = await r.json();
          const link = j.download_url || j.url || (j.file && (j.file.download_url || j.file.url));
          if (link) {
            const r2 = await fetch(link, { credentials: "include" });
            if (r2.ok) return { blob: await r2.blob(), type: r2.headers.get("content-type") || "" };
          }
          if (j.content_base64) {
            const bin = atob(j.content_base64), u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return { blob: new Blob([u8], { type: j.mime || "application/octet-stream" }), type: j.mime || "" };
          }
          continue;
        }
        const b = await r.blob();
        if (b.size) return { blob: b, type: ct };
      } catch (e) { /* 继续尝试下一个 */ }
    }
    return null;
  }
  // 站内图片只有预览图（webp），转成原始扩展名以减少兼容问题。
  async function convertImage(blob, mime) {
    if (typeof createImageBitmap !== "function" || typeof document.createElement !== "function") return null;
    try {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width; canvas.height = bmp.height;
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      return await new Promise(res => canvas.toBlob(res, mime, 0.95));
    } catch (e) { return null; }
  }

  /* ---------------- Markdown 渲染 ---------------- */
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  }
  function md(src) {
    const lines = String(src == null ? "" : src).replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0, para = [];
    const flush = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    while (i < lines.length) {
      const L = lines[i];
      if (/^```/.test(L)) {
        flush();
        let buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|[\s:\-|]*$/.test(lines[i + 1])) {
        flush();
        const rows = []; let j = i;
        while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
        const cells = r => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
        let t = "<table><thead><tr>" + cells(rows[0]).map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        for (let k = 2; k < rows.length; k++) t += "<tr>" + cells(rows[k]).map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>";
        out.push(t + "</tbody></table>");
        i = j; continue;
      }
      const h = L.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flush(); const lv = Math.min(h[1].length, 4); out.push("<h" + lv + ">" + inline(h[2].trim()) + "</h" + lv + ">"); i++; continue; }
      if (/^\s*>/.test(L)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + buf.map(inline).join("<br>") + "</blockquote>");
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(L)) {
        flush();
        const ordered = /^\s*\d+\./.test(L), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "")); i++;
        }
        out.push((ordered ? "<ol>" : "<ul>") + items.map(x => "<li>" + inline(x) + "</li>").join("") + (ordered ? "</ol>" : "</ul>"));
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(L)) { flush(); out.push("<hr>"); i++; continue; }
      if (!L.trim()) { flush(); i++; continue; }
      para.push(L); i++;
    }
    flush();
    return out.join("\n");
  }

  /* ---------------- 会话数据整理 ---------------- */
  function bodyText(m) {
    const t = (m.text || "").trim();
    if (t) return t;
    return (m.content || []).filter(b => b.type === "text" && (b.text || "").trim())
      .map(b => b.text.trim()).join("\n\n");
  }
  function resultText(b) {
    const out = [];
    (b.content || []).forEach(c => {
      if (c && typeof c === "object") {
        if (c.type === "text") out.push(c.text || "");
        else out.push("[" + c.type + "] " + JSON.stringify(c).slice(0, 400));
      } else out.push(String(c));
    });
    return out.join("\n").trim();
  }
  function sourceItem(status, source, note) {
    return { status: status, source: source, note: note };
  }
  function addSource(assets, path, kind, name, size, desc, source) {
    const asset = {
      path: path, name: name, kind: kind, size: size, desc: desc,
      source: source.source, status: source.status, note: source.note
    };
    if (source.preview) asset.preview = true;
    assets.push(asset);
    return asset;
  }
  async function collectAttachmentFiles(org, msgs, entries, assets) {
    const seen = new Set();
    for (const m of msgs) {
      for (const a of (m.attachments || [])) {
        const text = a.extracted_content || a.extracted_text || "";
        const kind = a.file_type || "txt";
        const name = safeName(a.file_name || ("附件-" + kind));
        if (seen.has(name)) continue;
        seen.add(name);

        let original = null;
        if (a.file_uuid) {
          try { original = await fetchFile(org, a.file_uuid); } catch (e) { original = null; }
        }
        if (original) {
          const buf = new Uint8Array(await original.blob.arrayBuffer());
          entries.push({ name: "files/attachments/" + name, data: buf });
          addSource(assets, "files/attachments/" + name, kind.toUpperCase().slice(0, 4), name, buf.length,
            "会话中的附件原件，已保存原始文件。",
            sourceItem("downloaded", "claude-file-api", "原始二进制文件。"));
          continue;
        }
        if (text) {
          entries.push({ name: "files/attachments/" + name, data: enc.encode(text) });
          addSource(assets, "files/attachments/" + name, kind.toUpperCase().slice(0, 4), name, enc.encode(text).length,
            "会话中的附件，已保存提取后的全文。",
            sourceItem("extracted-text", "claude-api-extracted-content", "原始二进制未嵌入。"));
        } else {
          addSource(assets, "", kind.toUpperCase().slice(0, 4), name, a.file_size || 0,
            "会话中的附件，接口未返回提取文本。",
            sourceItem("metadata-only", "claude-api", "请在 claude.ai 页面手动下载原件。"));
        }
      }
    }
  }
  function artifactPathSet(msgs) {
    const set = new Set();
    msgs.forEach(m => (m.content || []).forEach(b => {
      if (b.type !== "tool_use" || b.name !== "Artifact") return;
      const inp = b.input || {};
      if (typeof inp.file_path === "string") set.add(inp.file_path);
      if (inp.files && typeof inp.files === "object") {
        const root = (inp.root || "").replace(/\/+$/, "");
        Object.keys(inp.files).forEach(k => set.add((root ? root + "/" : "") + (inp.files[k] || k)));
      }
    }));
    return set;
  }
  function replayFiles(msgs, want) {
    const files = new Map();
    msgs.forEach(m => (m.content || []).forEach(b => {
      if (b.type !== "tool_use") return;
      const inp = b.input || {};
      if (b.name === "Bash") {
        applySimpleSed(String(inp.command || ""), files, want);
        return;
      }
      const p = inp.file_path;
      if (!p || !want(p)) return;
      if (b.name === "Write") {
        files.set(p, inp.content == null ? "" : inp.content);
      } else if (b.name === "Edit") {
        const cur = files.get(p);
        if (typeof cur !== "string") return;
        const oldS = inp.old_string || "", newS = inp.new_string || "";
        if (!oldS) return;
        if (inp.replace_all) files.set(p, cur.split(oldS).join(newS));
        else {
          const idx = cur.indexOf(oldS);
          if (idx >= 0) files.set(p, cur.slice(0, idx) + newS + cur.slice(idx + oldS.length));
        }
      }
    }));
    return files;
  }
  // 只处理 `sed -i 's/旧/新/g' 文件` 这类简单替换，用于还原会话中的批量改名。
  function applySimpleSed(cmd, files, want) {
    const m = cmd.match(/sed\s+-i\s+'s\/((?:\\.|[^/])*)\/((?:\\.|[^/])*)\/g'\s+([^\s;&|]+)/);
    if (!m) return;
    const unescape = s => s.replace(/\\(.)/g, "$1");
    const oldS = unescape(m[1]), newS = unescape(m[2]);
    let target = m[3];
    if (target.indexOf("/") !== 0) {
      const cd = cmd.match(/(?:^|&&)\s*cd\s+([^\s;&|]+)/);
      if (cd) target = cd[1].replace(/\/+$/, "") + "/" + target;
    }
    if (!want(target)) return;
    const cur = files.get(target);
    if (typeof cur !== "string") return;
    files.set(target, cur.split(oldS).join(newS));
  }
  function artifactVersions(msgs, wanted) {
    const versions = new Map();
    msgs.forEach(m => (m.content || []).forEach(b => {
      if (b.type !== "tool_use") return;
      const inp = b.input || {};
      if (b.name === "Artifact" && inp.file_path && wanted.has(inp.file_path)) {
        if (!versions.has(inp.file_path)) versions.set(inp.file_path, []);
        versions.get(inp.file_path).push({ version: versions.get(inp.file_path).length + 1, source: "artifact-tool-use", note: "来自 Artifact 工具调用记录。" });
      }
      if ((b.name === "Write" || b.name === "Edit") && inp.file_path && wanted.has(inp.file_path)) {
        if (!versions.has(inp.file_path)) versions.set(inp.file_path, []);
        versions.get(inp.file_path).push({ version: versions.get(inp.file_path).length + 1, source: "write-or-edit", note: b.name + " 记录。" });
      }
    }));
    return versions;
  }
  function collectArtifacts(msgs, entries, assets) {
    const wanted = artifactPathSet(msgs);
    if (!wanted.size) return;
    const files = replayFiles(msgs, p => wanted.has(p));
    const used = new Set();
    files.forEach((text, p) => {
      const base = safeName(basename(p));
      const ext = (base.split(".").pop() || "").toLowerCase();
      if (!["html", "htm", "svg", "md", "json", "css", "js", "txt"].includes(ext)) return;
      let name = base;
      if (used.has(name)) {
        const dir = basename(String(p).slice(0, String(p).lastIndexOf("/")));
        name = safeName(dir + "-" + base);
      }
      used.add(name);
      const path = "files/artifacts/" + name;
      entries.push({ name: path, data: enc.encode(text) });
      const vers = artifactVersions(msgs, wanted).get(p) || [];
      addSource(assets, path, ext.toUpperCase().slice(0, 4), name, enc.encode(text).length,
        "Claude Artifact 源文件，按会话中的写入与编辑记录还原" + (vers.length ? "（" + vers.length + " 次写入/编辑）" : "") + "。",
        sourceItem("replayed", "session-write-edits", "如需完整版本历史，请保留 conversation.json 重新回放。"));
    });
  }
  function collectDeliveries(msgs) {
    const list = [];
    msgs.forEach(m => (m.content || []).forEach(b => {
      if (b.type !== "tool_result" || b.name !== "SendUserFile") return;
      (b.file_deliveries || []).forEach(d => {
        if (d && d.file_uuid) list.push({ uuid: d.file_uuid, path: d.path || "" });
      });
    }));
    return list;
  }
  async function collectDeliveryFiles(org, msgs, entries, assets, missing) {
    const list = collectDeliveries(msgs);
    if (!list.length) return;

    // 文件元数据（大小、真实文件名）
    const meta = {};
    msgs.forEach(m => (m.files || []).forEach(f => {
      if (f.file_uuid) meta[f.file_uuid] = { name: f.file_name, size: f.size_bytes };
    }));

    // 会话中写入过的文件，按文件名索引，用于接口取不到时还原文本类文件。
    const written = replayFiles(msgs, () => true);
    const byBase = {};
    written.forEach((text, p) => {
      const k = basename(p).toLowerCase();
      if (!byBase[k] || byBase[k].text.length > text.length) byBase[k] = { text: text, path: p };
    });

    const seen = new Set();
    for (const d of list) {
      const real = (meta[d.uuid] && meta[d.uuid].name) || basename(d.path) || (d.uuid + ".bin");
      const name = safeName(real);
      if (seen.has(name)) continue;
      seen.add(name);

      const ext = (name.split(".").pop() || "").toLowerCase();
      let got = null;
      try { got = await fetchFile(org, d.uuid); } catch (e) { got = null; }

      if (got) {
        let blob = got.blob;
        let source = "claude-file-api";
        let note = "来自站内文件接口。";
        if (/^image\//.test(got.type) && ["png", "jpg", "jpeg"].includes(ext)) {
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const converted = await convertImage(blob, mime);
          if (converted) { blob = converted; source = "claude-image-preview"; note = "站内只提供预览图，已按原扩展名转换，分辨率可能与原图不同。"; }
        }
        const buf = new Uint8Array(await blob.arrayBuffer());
        entries.push({ name: "files/deliveries/" + name, data: buf });
        const src = sourceItem("downloaded", source, note);
        if (source === "claude-image-preview") src.preview = true;
        addSource(assets, "files/deliveries/" + name, ext.toUpperCase().slice(0, 4), name, buf.length,
          "Claude 在会话中发送的文件。" + note, src);
        continue;
      }

      // 文本类文件：若会话里有它的写入记录，直接还原。
      const hit = byBase[name.toLowerCase()];
      if (hit && hit.text) {
        const bytes = enc.encode(hit.text).length;
        const expect = meta[d.uuid] && meta[d.uuid].size;
        if (!expect || Math.abs(bytes - expect) <= Math.max(64, expect * 0.05)) {
          entries.push({ name: "files/deliveries/" + name, data: enc.encode(hit.text) });
          addSource(assets, "files/deliveries/" + name, ext.toUpperCase().slice(0, 4), name, bytes,
            "Claude 在会话中发送的文件，按会话里的写入记录还原。",
            sourceItem("replayed", "session-write-edits", "接口未返回二进制时启用。"));
          continue;
        }
      }

      // zip：按会话里的 Write/Edit 记录重建目录并打包。
      if (ext === "zip") {
        const zipPath = String(d.path || "").replace(/\/+$/, "");
        const parent = zipPath.slice(0, zipPath.lastIndexOf("/"));
        const stem = basename(zipPath).replace(/\.zip$/i, "");
        if (parent) {
          const folder = parent + "/" + stem + "/";
          const hasFolder = msgs.some(m => (m.content || []).some(b =>
            b.type === "tool_use" && String((b.input || {}).file_path || "").indexOf(folder) === 0));
          const prefix = hasFolder ? folder : parent + "/";
          const cut = parent + "/";
          const files = replayFiles(msgs, p => p.indexOf(prefix) === 0);
          if (files.size) {
            const inner = [];
            files.forEach((text, p) => inner.push({ name: p.slice(cut.length), data: enc.encode(text) }));
            const buf = makeZip(inner);
            entries.push({ name: "files/deliveries/" + name, data: buf });
            addSource(assets, "files/deliveries/" + name, "ZIP", name, buf.length,
              "Claude 在会话中发送的压缩包，已按写入记录重建（" + inner.length + " 个文件）。",
              sourceItem("rebuilt", "session-write-edits", "接口未返回压缩包二进制时启用。"));
            continue;
          }
        }
      }
      missing.push(name);
    }
  }

  /* ---------------- 页面生成 ---------------- */
  function renderBlocks(d) {
    const parts = [];
    (d.blocks || []).forEach(b => {
      if (b.type === "thinking") {
        const body = (b.summaries && b.summaries.length)
          ? "<ul>" + b.summaries.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>"
          : '<div class="think-body">' + esc(b.text) + "</div>";
        parts.push('<details class="think" data-kind="think"><summary>思考摘要' +
          (b.summaries && b.summaries.length ? "（" + b.summaries.length + " 步）" : "") + "</summary>" + body + "</details>");
      } else if (b.type === "text") {
        parts.push('<div class="md">' + md(b.text) + "</div>");
      } else if (b.type === "tool") {
        const rs = b.results || [];
        const stat = rs.length ? (rs[0].is_error ? '<span class="terr">失败</span>' : '<span class="tstat">完成</span>') : "";
        const prev = String(b.message || b.preview || "").slice(0, 110);
        const body = ['<div class="tbody"><div class="lbl">input</div><pre>' +
          esc(JSON.stringify(b.input, null, 2)) + "</pre>"];
        rs.forEach(r => {
          body.push('<div class="lbl">result' + (r.is_error ? " · error" : "") + "</div>");
          body.push('<pre' + (r.is_error ? ' class="err"' : "") + ">" + esc(r.text || "（空）") + "</pre>");
        });
        body.push("</div>");
        parts.push('<details class="tool" data-kind="tool"><summary><span class="tname">' + esc(b.name) +
          "</span>" + (prev ? '<span class="tmsg">' + esc(prev) + "</span>" : "") + stat + "</summary>" + body.join("") + "</details>");
      }
    });
    (d.atts || []).forEach(a => {
      const link = a.path ? ' <a class="mini" href="' + esc(a.path) + '">下载</a>' : "";
      parts.push('<div class="att"><span class="an">' + esc(a.name) + "</span>" + link +
        '<span class="am">' + esc(a.kind || "") + " " + human(a.size) + "</span>" +
        (a.text ? '<details><summary>展开全文（' + a.text.length.toLocaleString() + " 字符）</summary><pre>" + esc(a.text) + "</pre></details>" : "") +
        "</div>");
    });
    return parts.join("");
  }
  function assetCard(a) {
    const btn = a.missing
      ? '<span class="amiss">未能自动获取</span>'
      : '<a class="abtn" href="' + esc(a.path) + '" download>下载</a>' +
        (a.preview ? '<a class="abtn ghost" href="' + esc(a.path) + '" target="_blank">预览</a>' : "");
    const tag = a.source ? '<span class="asrc" data-src="' + esc(a.source) + '" data-status="' + esc(a.status || "") + '">' +
      esc(a.source) + (a.status && a.status !== "downloaded" ? " · " + a.status : "") + "</span>" : "";
    return '<div class="acard"><span class="akind">' + esc(a.kind) + "</span>" +
      '<div class="ainfo"><div class="aname">' + esc(a.name) + "</div>" +
      '<div class="adesc">' + esc(a.desc) + "</div>" +
      '<div class="ameta">' + (a.size ? human(a.size) : "") + "</div>" +
      '<div class="asrcs">' + tag + "</div></div>" +
      '<div class="abtns">' + btn + "</div></div>";
  }
  function buildManifest(conv, model, entries, assets, missing) {
    const files = entries.map(e => ({ path: e.name, size: e.data.length }));
    return {
      schema: "claude-archive/manifest-v1",
      exported_at: new Date().toISOString(),
      conversation: {
        id: conv.id || conv.conversation_uuid || "",
        name: conv.name || "",
        model: conv.model || "",
        created_at: conv.created_at || "",
        updated_at: conv.updated_at || ""
      },
      counts: {
        raw_messages: model.all,
        visible_messages: model.visible,
        tool_calls: model.tools,
        thinking_summaries: model.think,
        files: files.length
      },
      files: files,
      assets: assets,
      missing: missing
    };
  }
  function buildHtml(conv, model, entries, assets, missing) {
    const title = conv.name || "Claude 会话";
    const allMissing = missing.map(n => ({
      name: n, kind: (n.split(".").pop() || "bin").toUpperCase().slice(0, 4),
      desc: "无法通过接口下载，请在 claude.ai 的会话中点击原文件卡片获取。", missing: true
    }));
    const cards = assets.concat(allMissing).map(assetCard).join("");
    const msgs = model.data.map(d => {
      const isUser = d.sender === "human";
      return '<section class="msg ' + (isUser ? "user" : "assistant") + '" id="m' + d.no + '" data-role="' +
        (isUser ? "user" : "assistant") + '"><span class="dot"></span>' +
        '<div class="head"><span class="who">' + esc(d.role) + '</span><span class="idx">#' + d.no +
        '</span><span class="time">' + esc(d.at) + "</span></div>" +
        '<div class="card">' + renderBlocks(d) + "</div></section>";
    }).join("\n");

    return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + esc(title) + " · Claude 会话</title><style>" + PAGE_CSS + "</style></head><body>" +
      '<header class="top"><div class="top-in"><div class="eyebrow">Claude 会话完整导出</div>' +
      "<h1>" + esc(title) + "</h1><div class=\"meta\">" +
      '<span class="chip">' + esc(conv.model || "claude") + "</span>" +
      '<span class="chip">' + model.visible + " 条消息</span>" +
      '<span class="chip">' + model.tools + " 次工具调用</span>" +
      '<span class="chip">' + model.think + " 段思考摘要</span>" +
      '<span class="chip">创建 ' + esc((conv.created_at || "").slice(0, 19).replace("T", " ")) + "</span>" +
      '<span class="chip">更新 ' + esc((conv.updated_at || "").slice(0, 19).replace("T", " ")) + "</span></div>" +
      '<div class="bar"><input id="q" type="search" placeholder="搜索全文（按 / 聚焦）">' +
      '<button class="tog on" data-k="think">思考摘要</button>' +
      '<button class="tog on" data-k="tool">工具调用</button>' +
      '<button class="tog" data-k="onlyUser">只看你说</button>' +
      '<button class="tog" id="expand">全部展开</button></div></div></header>' +
      '<div class="layout"><section class="assets"><div class="atitle">会话产出的文件<span class="asub">ZIP 解压后可直接打开，无需再登录 claude.ai</span></div>' +
      '<div class="agrid">' + cards + "</div></section>" +
      '<main id="stream">' + msgs + "</main></div>" +
      '<footer class="end">数据来源：claude.ai 会话接口 · 导出时间 ' + esc(new Date().toLocaleString("zh-CN")) +
      " · 共 " + model.all + " 条原始消息（含工具轮次）</footer>" +
      "<script>" + PAGE_JS + "</script></body></html>";
  }

  const PAGE_CSS = `
:root{--bg:#F5F6F2;--card:#fff;--ink:#14232E;--muted:#4F5E69;--line:#D9DFE1;--teal:#0B6E7F;--teal-soft:#E3F3F5;--orange:#C85F12;--orange-soft:#FBEFE3;--dark:#13202A;--dark-ink:#E6EEF2;--dark-muted:#9FB1BE;--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;--sans:"Noto Sans SC",-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.75}
a{color:var(--teal)}
header.top{position:sticky;top:0;z-index:20;background:rgba(245,246,242,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1180px;margin:0 auto;padding:16px 32px 12px}
.eyebrow{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--orange);font-weight:700}
h1{font-size:25px;line-height:1.3;margin:6px 0 10px;font-weight:800}
.meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--muted);font-family:var(--mono)}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:2px 10px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
.bar input{flex:1 1 240px;min-width:180px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:13.5px;outline:none;background:#fff}
.bar input:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(11,110,127,.12)}
.tog{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 12px;font-size:12.5px;color:var(--muted);cursor:pointer}
.tog.on{background:var(--teal-soft);border-color:#B9DEE4;color:var(--teal);font-weight:600}
.layout{max-width:1180px;margin:0 auto;padding:26px 32px 100px}
.assets{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px 20px;margin-bottom:24px}
.atitle{font-weight:800;font-size:15px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}
.asub{font-weight:400;font-size:12px;color:#8A98A3}
.agrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:860px){.agrid{grid-template-columns:1fr}.top-in,.layout{padding-left:18px;padding-right:18px}}
.acard{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:#FCFDFB}
.akind{flex:0 0 auto;font-family:var(--mono);font-size:10px;font-weight:700;color:#fff;background:var(--teal);border-radius:5px;padding:3px 6px;margin-top:2px}
.ainfo{flex:1 1 auto;min-width:0}.aname{font-family:var(--mono);font-size:12.8px;font-weight:700;word-break:break-all}
.adesc{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.6}.ameta{font-size:11px;color:#93A1A9;margin-top:4px;font-family:var(--mono)}
.asrcs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.asrc{font-family:var(--mono);font-size:10px;background:#E3F3F5;color:#0B6E7F;border-radius:4px;padding:2px 6px}
.asrc[data-status="replayed"],.asrc[data-status="rebuilt"]{background:#FBEFE3;color:#C85F12}
.asrc[data-status="extracted-text"]{background:#EAF3F4;color:#0B6E7F}
.asrc[data-status="metadata-only"]{background:#F3F4F6;color:#5E6B75}
.abtns{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;align-items:stretch}
.abtn{border:1px solid var(--dark);background:var(--dark);color:#fff;border-radius:7px;padding:5px 11px;font-size:12px;text-align:center;text-decoration:none;font-weight:600}
.abtn.ghost{background:#fff;color:var(--ink);border-color:var(--line)}
.amiss{font-size:11px;color:#C85F12;white-space:nowrap}
.msg{position:relative;padding-left:26px;margin-bottom:26px}
.msg::before{content:"";position:absolute;left:7px;top:8px;bottom:-26px;width:1px;background:var(--line)}
.msg:last-child::before{display:none}
.dot{position:absolute;left:0;top:6px;width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid var(--teal)}
.msg.user .dot{border-color:var(--orange);border-radius:4px;transform:rotate(45deg)}
.head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.who{font-weight:800;font-size:14px}.msg.user .who{color:var(--orange)}.msg.assistant .who{color:var(--teal)}
.idx,.time{font-family:var(--mono);font-size:11.5px;color:#8A98A3}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.msg.user .card{background:var(--orange-soft);border-color:#EFD7C3}
.card>*:first-child{margin-top:0}.card>*:last-child{margin-bottom:0}
.card h1,.card h2,.card h3,.card h4{line-height:1.45;margin:20px 0 8px;font-weight:800}
.card h1{font-size:20px}.card h2{font-size:18px}.card h3{font-size:16px}.card h4{font-size:14.5px}
.card p{margin:9px 0}.card ul,.card ol{margin:9px 0;padding-left:22px}.card li{margin:3px 0}
.card code{font-family:var(--mono);font-size:12.8px;background:#EDF1F2;padding:1.5px 5px;border-radius:4px}
.card pre{background:var(--dark);color:var(--dark-ink);border-radius:9px;padding:14px 16px;overflow:auto;margin:12px 0;font-size:12.6px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.card pre code{background:none;padding:0;color:inherit;font-size:inherit}
.card blockquote{margin:12px 0;padding:6px 14px;border-left:3px solid var(--teal);color:var(--muted);background:#F7FAFA}
.card table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
.card th,.card td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
.card th{background:#F1F4F4;font-weight:700}.card hr{border:none;border-top:1px solid var(--line);margin:18px 0}
details.think{margin:0 0 12px;border:1px solid #E2E8E9;background:#FAFBFA;border-radius:10px;padding:10px 14px}
details.think summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--muted)}
details.think ul{margin:8px 0 0;padding-left:18px;color:#54626B;font-size:13px;line-height:1.65}
.think-body{margin-top:8px;color:#54626B;font-size:13px;white-space:pre-wrap;font-style:italic}
details.tool{margin:9px 0;border:1px solid #22323E;background:var(--dark);border-radius:10px;overflow:hidden}
details.tool summary{cursor:pointer;list-style:none;padding:9px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
details.tool summary::-webkit-details-marker{display:none}
.tname{font-family:var(--mono);font-size:12px;font-weight:700;color:#8FE3F0;background:#1B3038;border-radius:5px;padding:1px 7px}
.tmsg{font-size:12px;color:var(--dark-muted);overflow:hidden;text-overflow:ellipsis;max-width:70%;white-space:nowrap}
.terr{font-family:var(--mono);font-size:11px;color:#F0A6A0}.tstat{font-family:var(--mono);font-size:11px;color:#6E828D;margin-left:auto}
.tbody{padding:0 14px 12px}.tbody .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#6E828D;margin:8px 0 4px}
.tbody pre{margin:0 0 8px;padding:10px 12px;background:#0C1721;border-radius:8px;color:#CFE0E8;font-size:12px;line-height:1.55;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.tbody pre.err{color:#F3B7B1}
.att{border:1px dashed #C9D6D9;border-radius:9px;padding:9px 12px;background:#FBFCFA;font-size:12.5px;margin-top:10px}
.att .an{font-weight:700}.att .am{font-family:var(--mono);font-size:11px;color:#8A98A3;margin-left:8px}
.att .mini{font-size:11.5px;margin-left:8px}.att details{margin-top:6px}
.att summary{cursor:pointer;font-size:12px;color:var(--teal)}
.att pre{margin:8px 0 0;max-height:340px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:7px;padding:10px;font-size:11.8px;line-height:1.6;white-space:pre-wrap}
.hidden{display:none!important}
footer.end{max-width:1180px;margin:0 auto;padding:0 32px 60px;color:#93A1A9;font-size:12px;font-family:var(--mono)}
@media print{header.top{position:static}.bar{display:none}.layout{padding:0}.msg{break-inside:avoid-page}}
`;

  const PAGE_JS = `
const state={think:true,tool:true,onlyUser:false};
const q=document.getElementById('q');
function apply(){
  const kw=q.value.trim().toLowerCase();
  document.querySelectorAll('.msg').forEach(m=>{
    const roleOk=!state.onlyUser||m.dataset.role==='user';
    const hit=!kw||m.innerText.toLowerCase().indexOf(kw)>=0;
    m.classList.toggle('hidden',!(roleOk&&hit));
  });
  document.querySelectorAll('details[data-kind="think"]').forEach(d=>d.classList.toggle('hidden',!state.think));
  document.querySelectorAll('details[data-kind="tool"]').forEach(d=>d.classList.toggle('hidden',!state.tool));
  document.querySelectorAll('.tog[data-k]').forEach(b=>b.classList.toggle('on',!!state[b.dataset.k]));
}
document.querySelectorAll('.tog[data-k]').forEach(b=>b.addEventListener('click',()=>{state[b.dataset.k]=!state[b.dataset.k];apply();}));
q.addEventListener('input',apply);
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}if(e.key==='Escape'&&document.activeElement===q){q.value='';apply();q.blur();}});
document.getElementById('expand').addEventListener('click',()=>{
  const open=document.getElementById('expand').classList.toggle('on');
  document.querySelectorAll('details').forEach(d=>d.open=open);
});
apply();
`;

  /* ---------------- 主流程 ---------------- */
  async function buildArchive() {
    const id = conversationId();
    if (!id) throw new Error("当前页面不是 Claude 会话页");
    const loaded = await loadConversation(id);
    const conv = loaded.conv;
    const org = loaded.org;
    const msgs = conv.chat_messages || [];

    const entries = [];
    const assets = [];
    const missing = [];

    const model = buildModel(msgs);
    await collectAttachmentFiles(org, msgs, entries, assets);
    collectArtifacts(msgs, entries, assets);
    await collectDeliveryFiles(org, msgs, entries, assets, missing);

    entries.unshift({ name: "conversation.json", data: enc.encode(JSON.stringify(conv, null, 2)) });
    const html = buildHtml(conv, model, entries, assets, missing);
    entries.unshift({ name: "index.html", data: enc.encode(html) });
    entries.push({ name: "manifest.json", data: enc.encode(JSON.stringify(buildManifest(conv, model, entries, assets, missing), null, 2)) });

    const zip = makeZip(entries);
    return { zip: zip, title: conv.name || "claude-conversation", count: entries.length };
  }

  function buildModel(msgs) {
    const results = {};
    msgs.forEach(m => (m.content || []).forEach(b => {
      if (b.type === "tool_result") {
        const k = b.tool_use_id;
        (results[k] = results[k] || []).push(b);
      }
    }));

    let nTool = 0, nThink = 0, nVisible = 0;
    const data = msgs.map((m, i) => {
      const blocks = [];
      (m.content || []).forEach(b => {
        if (b.type === "text") {
          if ((b.text || "").trim()) blocks.push({ type: "text", text: b.text });
        } else if (b.type === "thinking") {
          const sums = (b.summaries || []).filter(s => s && s.summary).map(s => s.summary);
          if (sums.length || (b.thinking || "").trim()) blocks.push({ type: "thinking", text: b.thinking || "", summaries: sums });
        } else if (b.type === "tool_use") {
          const rs = (results[b.id] || []).map(r => ({ text: resultText(r), is_error: !!r.is_error }));
          let preview = "";
          const inp = b.input || {};
          if (b.name === "Bash" && inp.command) preview = inp.command;
          else if (inp.file_path) preview = inp.file_path;
          else if (inp.subject || inp.description) preview = inp.subject || inp.description;
          blocks.push({ type: "tool", name: b.name, input: b.input, message: preview, results: rs });
        }
      });
      (m.content || []).forEach(b => {
        if (b.type === "thinking") nThink++;
        if (b.type === "tool_use") nTool++;
      });

      const atts = [];
      (m.attachments || []).forEach((a, ai) => {
        const text = a.extracted_content || a.extracted_text || "";
        const kind = a.file_type || "txt";
        const name = safeName(a.file_name || ("附件-" + (i + 1) + (ai ? "-" + (ai + 1) : "") + "." + kind));
        atts.push({
          name: name, kind: kind, size: a.file_size || enc.encode(text).length,
          text: text, path: text ? ("files/attachments/" + name) : ""
        });
      });
      (m.files || []).forEach(f => {
        atts.push({
          name: safeName(f.file_name || "文件"), kind: f.file_kind || "file",
          size: f.size_bytes || 0, text: "", path: ""
        });
      });

      const txt = bodyText(m);
      if (txt) nVisible++;
      return {
        no: i + 1, role: m.sender === "human" ? "你" : "Claude", sender: m.sender,
        at: (m.created_at || "").slice(0, 19).replace("T", " "),
        blocks: blocks, atts: atts, text: txt
      };
    });

    return { data: data, tools: nTool, think: nThink, visible: nVisible, all: msgs.length };
  }

  function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ---------------- 界面 ---------------- */
  function panel() {
    let p = document.getElementById("cae-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "cae-panel";
      p.style.cssText = "position:fixed;right:20px;bottom:132px;z-index:2147483000;max-width:320px;background:#13202A;color:#E6EEF2;" +
        "font:12.5px/1.6 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;padding:10px 14px;border-radius:10px;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.25);display:none;white-space:pre-wrap";
      document.body.appendChild(p);
    }
    return p;
  }
  function status(text, show) {
    const p = panel();
    p.textContent = text;
    p.style.display = show === false ? "none" : "block";
  }
  function inject() {
    if (document.getElementById("cae-btn")) return;
    const b = document.createElement("button");
    b.id = "cae-btn";
    b.textContent = "导出归档 ZIP";
    b.style.cssText = "position:fixed;right:20px;bottom:84px;z-index:2147483001;border:none;background:#0B6E7F;color:#fff;" +
      "font:600 13px -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;padding:10px 16px;border-radius:999px;" +
      "cursor:pointer;box-shadow:0 6px 18px rgba(11,110,127,.35)";
    b.addEventListener("click", async () => {
      if (busy) return;
      busy = true; b.disabled = true; b.style.opacity = ".6";
      try {
        status("读取会话与附件…");
        const out = await buildArchive();
        status("打包完成：" + out.count + " 个条目 · " + human(out.zip.length) + "，开始下载…");
        download(out.zip, slug(out.title) + "_" + stamp() + ".zip");
        setTimeout(() => status("已下载。解压后打开 index.html 即可离线查看。"), 800);
      } catch (e) {
        status("导出失败：" + (e && e.message ? e.message : e));
      } finally {
        busy = false; b.disabled = false; b.style.opacity = "1";
      }
    });
    document.body.appendChild(b);
  }
  inject();
  setInterval(inject, 2000);
})();
