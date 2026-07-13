const COMMENT_MARKER = '<!-- veye:gate-comment -->';
const API_BASE = 'https://api.github.com';

interface IssueComment {
  id: number;
  body: string | null;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function errorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return `(${res.status} ${res.statusText}) ${text}`;
}

export async function findExistingComment(
  githubToken: string,
  repo: string,
  prNumber: number
): Promise<number | null> {
  const url = `${API_BASE}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const res = await fetch(url, { headers: authHeaders(githubToken) });
  if (!res.ok) {
    throw new Error(`GitHub API: list PR comments failed ${await errorBody(res)}`);
  }
  const comments = (await res.json()) as IssueComment[];
  for (const comment of comments) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return comment.id;
    }
  }
  return null;
}

export async function updateComment(
  githubToken: string,
  repo: string,
  commentId: number,
  body: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${repo}/issues/comments/${commentId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(githubToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API: update PR comment failed ${await errorBody(res)}`);
  }
}

export async function createComment(
  githubToken: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: { ...authHeaders(githubToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API: create PR comment failed ${await errorBody(res)}`);
  }
}

export async function postOrUpdateComment(
  githubToken: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const existingId = await findExistingComment(githubToken, repo, prNumber);
  if (existingId !== null) {
    await updateComment(githubToken, repo, existingId, body);
    return;
  }
  await createComment(githubToken, repo, prNumber, body);
}
