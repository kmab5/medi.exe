// GitHub writes, over the Git Data API.
//
// Uploads arrive one file per request because a serverless body caps out around
// 4.5MB and a series of album sheets easily exceeds that in total. Each request
// creates a blob and returns its sha; a final request assembles those shas into a
// single tree and one commit.
//
// Committing once rather than per-file matters for two reasons: every push to the
// repo triggers a Vercel rebuild, and a half-committed album would rebuild into a
// broken piece.

const API = 'https://api.github.com';

const repo = () => process.env.GITHUB_REPO;
const branch = () => process.env.GITHUB_BRANCH || 'main';
const token = () => process.env.GITHUB_TOKEN;

export const configured = () => Boolean(repo() && token());

async function gh(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token()}`,
      'user-agent': 'medi-wall',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Surface GitHub's own message: "not found" here almost always means the token
    // lacks contents:write rather than that the path is wrong.
    throw new Error(`github ${options.method ?? 'GET'} ${path} → ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function createBlob(base64) {
  const { sha } = await gh(`/repos/${repo()}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  return sha;
}

export async function readJsonFile(path) {
  try {
    const res = await gh(`/repos/${repo()}/contents/${path}?ref=${branch()}`);
    return JSON.parse(Buffer.from(res.content, 'base64').toString('utf8'));
  } catch (err) {
    // A missing meta.json on a fresh repo is not an error — it is an empty one.
    if (String(err.message).includes('404')) return null;
    throw err;
  }
}

// files: [{ path, sha }] for blobs already created, plus [{ path, content }] for
// small text files the server generates, such as the updated meta.json.
export async function commitFiles(files, message) {
  const ref = await gh(`/repos/${repo()}/git/ref/heads/${branch()}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh(`/repos/${repo()}/git/commits/${baseCommitSha}`);

  const tree = [];
  for (const f of files) {
    tree.push({
      path: f.path,
      mode: '100644',
      type: 'blob',
      ...(f.sha ? { sha: f.sha } : { content: f.content }),
    });
  }

  const newTree = await gh(`/repos/${repo()}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });

  const commit = await gh(`/repos/${repo()}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });

  await gh(`/repos/${repo()}/git/refs/heads/${branch()}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}
