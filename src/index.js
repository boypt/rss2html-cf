/**
 * rss2html — a Cloudflare Worker that fetches an RSS/Atom feed and renders
 * it as a simple HTML page. Zero dependencies.
 *
 * Usage:
 *   GET /                    — landing page
 *   GET /?url=https://example.com/feed.xml&limit=10
 *     url    (optional) address of the feed
 *     limit  (optional) how many entries to show (default 10, max 100)
 *     md     (optional) md=1 to render Markdown text/plain instead of HTML
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const HTML_CT = "text/html; charset=utf-8";
const MD_CT = "text/markdown; charset=utf-8";

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    if (reqUrl.pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const md = /^(1|true|yes)$/i.test(reqUrl.searchParams.get("md") || "");

    const feedUrl = reqUrl.searchParams.get("url");
    if (!feedUrl) {
      const body = md ? landingMarkdown() : landingPage();
      return new Response(body, { headers: { "Content-Type": md ? MD_CT : HTML_CT } });
    }
    if (!/^https?:\/\//i.test(feedUrl)) {
      return errorPage(
        400,
        "Invalid 'url' parameter",
        'Provide a valid feed address, e.g. <code>?url=https://example.com/feed.xml</code>.',
        md
      );
    }

    let limit = parseInt(reqUrl.searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let response;
    try {
      response = await fetch(feedUrl, {
        headers: { "User-Agent": "rss2html-worker/0.1" },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
    } catch (err) {
      return errorPage(502, "Failed to fetch the feed", escapeHtml(String((err && err.message) || err)), md);
    }
    if (!response.ok) {
      return errorPage(502, "Feed request failed", `The feed returned HTTP ${response.status} ${response.statusText}.`, md);
    }

    const xml = await response.text();
    let feed;
    try {
      feed = parseFeed(xml, feedUrl);
    } catch (err) {
      return errorPage(502, "Failed to parse the feed", escapeHtml(err.message), md);
    }
    if (feed.items.length === 0) {
      return errorPage(404, "No entries in feed", "The feed was read, but it contains no items.", md);
    }

    const items = feed.items.slice(0, limit);
    return new Response(md ? renderMarkdown(feed, items) : renderPage(feed, items), {
      headers: { "Content-Type": md ? MD_CT : HTML_CT },
    });
  },
};

/* ------------------------------------------------------------------ */
/* Feed parsing                                                        */
/* ------------------------------------------------------------------ */

function parseFeed(xml, feedUrl) {
  if (typeof xml !== "string" || xml.trim() === "") throw new Error("Empty response body");
  if (/<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)) return parseAtom(xml, feedUrl);
  if (/<rss[\s>]/i.test(xml) || /<rdf:RDF[\s>]/i.test(xml)) return parseRss(xml, feedUrl);
  throw new Error("Unrecognized feed format (expected RSS or Atom)");
}

function parseRss(xml, feedUrl) {
  const channel = matchFirst(xml, /<channel[^>]*>([\s\S]*?)<\/channel>/i);
  if (!channel) throw new Error("No <channel> element found");

  const base = absoluteLink(cleanText(matchFirst(channel, /<link[^>]*>([\s\S]*?)<\/link>/i)), feedUrl) || feedUrl;
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(channel)) !== null) {
    const body = m[1];
    items.push({
      title: cleanText(matchFirst(body, /<title[^>]*>([\s\S]*?)<\/title>/i)),
      link: absoluteLink(cleanText(matchFirst(body, /<link[^>]*>([\s\S]*?)<\/link>/i)), base),
      date: cleanText(matchFirst(body, /<(?:pubDate|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|dc:date)>/i)),
      description: resolveRelativeUrls(cleanHtml(matchFirst(body, /<description[^>]*>([\s\S]*?)<\/description>/i)), base),
    });
  }
  return {
    title: cleanText(matchFirst(channel, /<title[^>]*>([\s\S]*?)<\/title>/i)) || "Untitled feed",
    link: absoluteLink(cleanText(matchFirst(channel, /<link[^>]*>([\s\S]*?)<\/link>/i)), feedUrl),
    items,
  };
}

function parseAtom(xml, feedUrl) {
  const base = absoluteLink(cleanText(matchFirst(xml, /<link\b[^>]*href=["']([^"']+)["']/i)), feedUrl) || feedUrl;
  const items = [];
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const body = m[1];
    items.push({
      title: cleanText(matchFirst(body, /<title[^>]*>([\s\S]*?)<\/title>/i)),
      link: absoluteLink(matchFirst(body, /<link\b[^>]*href=["']([^"']+)["']/i), base),
      date: cleanText(
        matchFirst(body, /<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/i)
      ),
      description: resolveRelativeUrls(cleanHtml(
        matchFirst(body, /<(?:summary|content)[^>]*>([\s\S]*?)<\/(?:summary|content)>/i)
      ), base),
    });
  }
  return {
    title: cleanText(matchFirst(xml, /<title[^>]*>([\s\S]*?)<\/title>/i)) || "Untitled feed",
    link: absoluteLink(matchFirst(xml, /<link\b[^>]*href=["']([^"']+)["']/i), feedUrl),
    items,
  };
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function matchFirst(xml, re) {
  const m = re.exec(xml);
  return m ? m[1] : "";
}

/** Strip tags + decode entities — for titles and dates. */
function cleanText(s) {
  return cleanHtml(s).replace(/<[^>]*>/g, "").trim();
}

/** Decode entities + strip script/style — keeps other HTML, for descriptions. */
function cleanHtml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .trim();
}

function absoluteLink(link, base) {
  if (!link) return "";
  try {
    return new URL(link, base || undefined).href;
  } catch {
    return link;
  }
}

/** Resolve relative href/src URLs in HTML content to absolute URLs. */
function resolveRelativeUrls(html, base) {
  if (!html || !base) return html;
  return html.replace(
    /\b(href|src)=["']([^"']+)["']/gi,
    (_, attr, url) => `${attr}="${absoluteLink(url, base)}"`
  );
}

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

/** Collapse all whitespace runs into single spaces — for titles and dates. */
function oneLine(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

/** Wrap a URL in <…> when plain form would break the Markdown link syntax. */
function mdUrl(url) {
  const u = String(url == null ? "" : url).trim();
  return /[\s()]/.test(u) ? `<${u}>` : u;
}

/**
 * Convert the pre-cleaned description HTML into Markdown-ish plain text:
 * links/images/lists/headings survive, every other tag is dropped.
 * Entities were already decoded by cleanHtml, so they are not decoded again.
 */
function htmlToMarkdown(html) {
  if (!html) return "";
  const quote = (block) => `\n\n${block.split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;
  return html
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, url, label) => (label.trim() ? `[${label}](${mdUrl(url)})` : mdUrl(url)))
    .replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (_, src) => `![](${mdUrl(src)})`)
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => quote(t.trim()))
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${t.trim()}\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${"#".repeat(Number(n))} ${t.trim()}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|section|article|header|footer|ul|ol|dl|dd|dt|table|thead|tbody)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderMarkdown(feed, items) {
  const out = [`# ${oneLine(feed.title) || "Untitled feed"}`, ""];
  if (feed.link) out.push(`<${mdUrl(feed.link)}>`, "");

  items.forEach((it, i) => {
    out.push(`## ${i + 1}. ${oneLine(it.title) || `(untitled #${i + 1})`}`, "");
    const meta = [];
    if (it.link) meta.push(`- URL: ${mdUrl(it.link)}`);
    if (it.date) meta.push(`- Date: ${oneLine(it.date)}`);
    if (meta.length) out.push(meta.join("\n"), "");
    const body = htmlToMarkdown(it.description);
    if (body) out.push(body, "");
    out.push("---", "");
  });

  out.push(`_${items.length} entries · generated by rss2html_`, "");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderPage(feed, items) {
  const feedLink = feed.link
    ? `<a href="${escapeHtml(feed.link)}">${escapeHtml(feed.title)}</a>`
    : escapeHtml(feed.title);

  const rows = items
    .map((it, i) => {
      const title = it.title || `(untitled #${i + 1})`;
      const link = it.link
        ? `<a href="${escapeHtml(it.link)}">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      const date = it.date ? `<div class="date">${escapeHtml(it.date)}</div>` : "";
      const desc = it.description ? `<div class="desc">${it.description}</div>` : "";
      return `<article><h3>${link}</h3>${date}${desc}</article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rss2html: ${escapeHtml(feed.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 720px; margin: 0 auto; padding: 1rem; line-height: 1.6; color: #222; }
  header h1 { font-size: 1.4rem; margin: 0.5rem 0; }
  article { border-bottom: 1px solid #e5e5e5; padding: 0.8rem 0; }
  article h3 { margin: 0 0 0.2rem; font-size: 1.05rem; }
  article a { color: #1a5fb4; text-decoration: none; }
  article a:hover { text-decoration: underline; }
  .date { font-size: 0.8rem; color: #777; }
  .desc { font-size: 0.9rem; color: #444; margin-top: 0.3rem; word-break: break-word; }
  .desc img { max-width: 100%; height: auto; }
  footer { font-size: 0.8rem; color: #999; margin-top: 1rem; }
</style>
</head>
<body>
<header><h1>${feedLink}</h1></header>
<main>${rows}</main>
<footer>${items.length} entries · generated by rss2html</footer>
</body>
</html>`;
}

function landingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rss2html</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 1rem; line-height: 1.6; }
  code { background: #f4f4f4; padding: .1em .3em; border-radius: 4px; }
</style>
</head>
<body>
<h1>rss2html</h1>
<p>Convert any RSS/Atom feed into a clean HTML page.</p>
<p>Usage: <code>?url=&lt;feed-address&gt;&amp;limit=&lt;N&gt;</code></p>
</body>
</html>`;
}

function landingMarkdown() {
  return `# rss2html

Convert any RSS/Atom feed into a clean HTML page.

## Usage

    ?url=<feed-address>&limit=<N>&md=1

- \`url\` — feed address, required, must be \`http(s)://\`
- \`limit\` — how many entries to show, default 10, max 100
- \`md\` — \`md=1\` returns Markdown text instead of HTML

## Examples

    https://your-worker-url/?url=https://hnrss.org/frontpage
    https://your-worker-url/?url=https://hnrss.org/frontpage&limit=5
    https://your-worker-url/?url=https://hnrss.org/frontpage&md=1
`;
}

function errorPage(status, heading, detail, md) {
  if (md) {
    const body = `# ${status} — ${oneLine(heading)}\n\n${htmlToMarkdown(detail)}\n\n[← back](/)\n`;
    return new Response(body, { status, headers: { "Content-Type": MD_CT } });
  }
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rss2html: ${status} — ${escapeHtml(heading)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 1rem; line-height: 1.6; }
  code { background: #f4f4f4; padding: .1em .3em; border-radius: 4px; }
</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
<p>${detail}</p>
<p><a href="/">← back</a></p>
</body>
</html>`;
  return new Response(body, { status, headers: { "Content-Type": HTML_CT } });
}
